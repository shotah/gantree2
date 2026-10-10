// sso.go - Garmin SSO authentication (mobile iOS + DI OAuth).
//
// Matches cyberjunky/python-garminconnect ≥0.3 after the March 2026 auth break:
//  1. POST sso…/mobile/api/login (clientId=GCM_IOS_DARK)
//  2. Optional POST …/mobile/api/mfa/verifyCode
//  3. POST diauth…/di-oauth2-service/oauth/token (grant_type=service_ticket)
//
// The legacy connectapi oauth-service OAuth1→OAuth2 exchange returns 401 for new logins.
package garmin

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	iosSSOClientID  = "GCM_IOS_DARK"
	iosServiceURL   = "https://mobile.integration.garmin.com/gcm/ios"
	iosLoginUA      = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
	nativeAPIUA     = "GCM-Android-5.23"
	nativeXGarminUA = "com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0"

	diGrantType = "https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket"
)

var diClientIDs = []string{
	"GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2",
	"GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4",
	"GARMIN_CONNECT_MOBILE_ANDROID_DI",
	"GARMIN_CONNECT_MOBILE_IOS_DI",
}

var (
	csrfRE   = regexp.MustCompile(`name="_csrf"\s+value="([^"]+)"`)
	titleRE  = regexp.MustCompile(`<title>([^<]+)</title>`)
	ticketRE = regexp.MustCompile(`embed\?ticket=([^"]+)"`)
)

var (
	ErrCSRFNotFound   = errors.New("garmin: CSRF token not found")
	ErrTitleNotFound  = errors.New("garmin: title not found")
	ErrTicketNotFound = errors.New("garmin: ticket not found")
	ErrLoginFailed    = errors.New("garmin: login failed")
)

func extractCSRF(html string) (string, error) {
	m := csrfRE.FindStringSubmatch(html)
	if m == nil {
		return "", ErrCSRFNotFound
	}
	return m[1], nil
}

func extractTitle(html string) (string, error) {
	m := titleRE.FindStringSubmatch(html)
	if m == nil {
		return "", ErrTitleNotFound
	}
	return m[1], nil
}

func extractTicket(html string) (string, error) {
	m := ticketRE.FindStringSubmatch(html)
	if m == nil {
		return "", ErrTicketNotFound
	}
	return m[1], nil
}

// ssoClient handles the SSO authentication flow
type ssoClient struct {
	httpClient *http.Client
	domain     string
	timeout    time.Duration
}

// newSSOClient creates an SSO client. If baseClient is provided, its transport
// is reused (for VCR testing), otherwise a new client is created.
func newSSOClient(domain string, timeout time.Duration, baseClient *http.Client) (*ssoClient, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	return newSSOClientWithJar(domain, timeout, baseClient, jar)
}

func newSSOClientWithJar(domain string, timeout time.Duration, baseClient *http.Client, jar http.CookieJar) (*ssoClient, error) {
	if jar == nil {
		var err error
		jar, err = cookiejar.New(nil)
		if err != nil {
			return nil, err
		}
	}

	var httpClient *http.Client
	if baseClient != nil {
		httpClient = &http.Client{
			Transport: baseClient.Transport,
			Jar:       jar,
			Timeout:   timeout,
		}
	} else {
		httpClient = &http.Client{
			Jar:     jar,
			Timeout: timeout,
		}
	}

	return &ssoClient{
		httpClient: httpClient,
		domain:     domain,
		timeout:    timeout,
	}, nil
}

func (s *ssoClient) serviceURL() string {
	if s.domain == "garmin.cn" {
		return "https://mobile.integration.garmin.cn/gcm/ios"
	}
	return iosServiceURL
}

func (s *ssoClient) diTokenURL() string {
	return fmt.Sprintf("https://diauth.%s/di-oauth2-service/oauth/token", s.domain)
}

// ssoLogin performs mobile SSO + DI token exchange.
func (c *Client) ssoLogin(ctx context.Context, email, password string) error {
	sso, err := newSSOClient(c.opts.Domain, 30*time.Second, c.transport.client)
	if err != nil {
		return err
	}

	ticket, err := sso.authenticate(ctx, email, password, c.opts.MFAHandler)
	if err != nil {
		return err
	}
	return c.applyServiceTicket(ctx, sso, ticket)
}

func (c *Client) applyServiceTicket(ctx context.Context, sso *ssoClient, ticket string) error {
	if sso == nil {
		var err error
		sso, err = newSSOClient(c.opts.Domain, 30*time.Second, c.transport.client)
		if err != nil {
			return err
		}
	}
	token, err := sso.exchangeServiceTicket(ctx, ticket, sso.serviceURL())
	if err != nil {
		return fmt.Errorf("failed to exchange service ticket for DI token: %w", err)
	}

	c.auth.OAuth1Token = ""
	c.auth.OAuth1Secret = ""
	c.auth.MFAToken = ""
	c.auth.OAuth2AccessToken = token.AccessToken
	c.auth.OAuth2RefreshToken = token.RefreshToken
	c.auth.OAuth2Expiry = token.Expiry
	c.auth.OAuth2Scope = token.Scope
	c.auth.DIClientID = token.ClientID
	c.auth.Domain = c.opts.Domain
	return nil
}

// ChatLoginStart posts email/password. If MFA is required it writes pending
// state to pendingPath and returns mfaRequired=true (no session yet). If login
// succeeds without MFA it applies tokens on the client (caller saves session).
func (c *Client) ChatLoginStart(ctx context.Context, email, password, pendingPath string) (mfaRequired bool, mfaMethod string, err error) {
	sso, err := newSSOClient(c.opts.Domain, 30*time.Second, c.transport.client)
	if err != nil {
		return false, "", err
	}
	ticket, pending, err := sso.authenticateStart(ctx, email, password)
	if err != nil {
		return false, "", err
	}
	if pending != nil {
		pending.ExpiresAt = time.Now().Add(mfaPendingTTL)
		if err := SaveMFAPending(pendingPath, pending); err != nil {
			return false, "", fmt.Errorf("save MFA pending: %w", err)
		}
		return true, pending.MFAMethod, nil
	}
	ClearMFAPending(pendingPath)
	if err := c.applyServiceTicket(ctx, sso, ticket); err != nil {
		return false, "", err
	}
	return false, "", nil
}

// ChatLoginExchange completes a pending MFA challenge and applies tokens.
func (c *Client) ChatLoginExchange(ctx context.Context, pendingPath, code string) error {
	code = strings.TrimSpace(code)
	if code == "" {
		return errors.New("garmin: empty MFA code")
	}
	pending, err := LoadMFAPending(pendingPath)
	if err != nil {
		return err
	}
	jar, err := restoreSSOJar(pending.Domain, pending.Cookies)
	if err != nil {
		return err
	}
	sso, err := newSSOClientWithJar(pending.Domain, 30*time.Second, c.transport.client, jar)
	if err != nil {
		return err
	}
	ticket, err := sso.submitMobileMFA(ctx, pending.LoginParams, pending.MFAMethod, code)
	if err != nil {
		return err
	}
	if err := c.applyServiceTicket(ctx, sso, ticket); err != nil {
		return err
	}
	ClearMFAPending(pendingPath)
	return nil
}

type mobileSSOStatus struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

type mobileSSOResponse struct {
	ResponseStatus  mobileSSOStatus `json:"responseStatus"`
	ServiceTicketID string          `json:"serviceTicketId"`
	CustomerMfaInfo *struct {
		MfaLastMethodUsed string `json:"mfaLastMethodUsed"`
	} `json:"customerMfaInfo"`
	Error *struct {
		StatusCode string `json:"status-code"`
	} `json:"error"`
}

// authenticate performs mobile SSO login and returns a CAS service ticket.
func (s *ssoClient) authenticate(ctx context.Context, email, password string, mfaHandler func() (string, error)) (string, error) {
	ticket, pending, err := s.authenticateStart(ctx, email, password)
	if err != nil {
		return "", err
	}
	if pending == nil {
		return ticket, nil
	}
	return s.handleMobileMFA(ctx, pending.LoginParams, pending.MFAMethod, mfaHandler)
}

// authenticateStart posts credentials. On MFA_REQUIRED it returns pending state
// (caller persists cookies for a later process). On SUCCESS it returns a ticket.
func (s *ssoClient) authenticateStart(ctx context.Context, email, password string) (ticket string, pending *MFAPending, err error) {
	ssoBase := "https://sso." + s.domain
	serviceURL := s.serviceURL()

	loginParams := url.Values{
		"clientId": {iosSSOClientID},
		"locale":   {"en-US"},
		"service":  {serviceURL},
	}

	loginURL := ssoBase + "/mobile/api/login?" + loginParams.Encode()
	loginBody := map[string]any{
		"username":     email,
		"password":     password,
		"rememberMe":   true,
		"captchaToken": "",
	}
	respJSON, status, err := s.doSSOJSON(ctx, http.MethodPost, loginURL, loginBody)
	if err != nil {
		return "", nil, fmt.Errorf("failed to submit mobile login: %w", err)
	}
	if status == http.StatusTooManyRequests {
		return "", nil, fmt.Errorf("%w: mobile login rate limited (429)", ErrLoginFailed)
	}
	if status == http.StatusForbidden {
		return "", nil, fmt.Errorf("%w: mobile login blocked (403 Cloudflare)", ErrLoginFailed)
	}

	var parsed mobileSSOResponse
	if err := json.Unmarshal(respJSON, &parsed); err != nil {
		return "", nil, fmt.Errorf("failed to parse mobile login response (HTTP %d): %w", status, err)
	}
	if parsed.Error != nil && parsed.Error.StatusCode == strconv.Itoa(http.StatusTooManyRequests) {
		return "", nil, fmt.Errorf("%w: mobile login rate limited (429)", ErrLoginFailed)
	}

	switch parsed.ResponseStatus.Type {
	case "SUCCESSFUL":
		if parsed.ServiceTicketID == "" {
			return "", nil, fmt.Errorf("%w: empty service ticket", ErrLoginFailed)
		}
		return parsed.ServiceTicketID, nil, nil
	case "MFA_REQUIRED":
		mfaMethod := "email"
		if parsed.CustomerMfaInfo != nil && parsed.CustomerMfaInfo.MfaLastMethodUsed != "" {
			mfaMethod = parsed.CustomerMfaInfo.MfaLastMethodUsed
		}
		return "", &MFAPending{
			Domain:      s.domain,
			LoginParams: loginParams,
			MFAMethod:   mfaMethod,
			Cookies:     dumpSSOCookies(s.httpClient.Jar, s.domain),
		}, nil
	case "INVALID_USERNAME_PASSWORD":
		return "", nil, fmt.Errorf("%w: invalid username or password", ErrLoginFailed)
	case "CAPTCHA_REQUIRED":
		return "", nil, fmt.Errorf("%w: captcha required", ErrLoginFailed)
	default:
		msg := parsed.ResponseStatus.Type
		if parsed.ResponseStatus.Message != "" {
			msg = msg + ": " + parsed.ResponseStatus.Message
		}
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d", status)
		}
		return "", nil, fmt.Errorf("%w: %s", ErrLoginFailed, msg)
	}
}

func (s *ssoClient) handleMobileMFA(
	ctx context.Context,
	loginParams url.Values,
	mfaMethod string,
	mfaHandler func() (string, error),
) (string, error) {
	if mfaHandler == nil {
		return "", ErrMFARequired
	}

	mfaCode, err := mfaHandler()
	if err != nil {
		return "", fmt.Errorf("MFA handler failed: %w", err)
	}
	return s.submitMobileMFA(ctx, loginParams, mfaMethod, mfaCode)
}

func (s *ssoClient) submitMobileMFA(
	ctx context.Context,
	loginParams url.Values,
	mfaMethod, mfaCode string,
) (string, error) {
	ssoBase := "https://sso." + s.domain
	mfaURL := ssoBase + "/mobile/api/mfa/verifyCode?" + loginParams.Encode()
	body := map[string]any{
		"mfaMethod":           mfaMethod,
		"mfaVerificationCode": mfaCode,
		"rememberMyBrowser":   false,
		"reconsentList":       []any{},
		"mfaSetup":            false,
	}

	respJSON, status, err := s.doSSOJSON(ctx, http.MethodPost, mfaURL, body)
	if err != nil {
		return "", fmt.Errorf("failed to submit MFA code: %w", err)
	}

	var parsed mobileSSOResponse
	if err := json.Unmarshal(respJSON, &parsed); err != nil {
		return "", fmt.Errorf("failed to parse MFA response (HTTP %d): %w", status, err)
	}
	if parsed.ResponseStatus.Type != "SUCCESSFUL" || parsed.ServiceTicketID == "" {
		msg := parsed.ResponseStatus.Type
		if parsed.ResponseStatus.Message != "" {
			msg = msg + ": " + parsed.ResponseStatus.Message
		}
		return "", fmt.Errorf("%w: MFA failed (%s)", ErrLoginFailed, msg)
	}
	return parsed.ServiceTicketID, nil
}

// OAuth2Token represents a DI OAuth2 bearer token.
type OAuth2Token struct {
	AccessToken  string
	RefreshToken string
	Expiry       time.Time
	Scope        string
	TokenType    string
	ClientID     string
}

func (s *ssoClient) exchangeServiceTicket(ctx context.Context, ticket, serviceURL string) (*OAuth2Token, error) {
	var lastErr error
	for _, clientID := range diClientIDs {
		token, err := s.postDIToken(ctx, url.Values{
			"client_id":      {clientID},
			"service_ticket": {ticket},
			"grant_type":     {diGrantType},
			"service_url":    {serviceURL},
		}, clientID)
		if err == nil {
			return token, nil
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = errors.New("no DI client IDs configured")
	}
	return nil, lastErr
}

func (s *ssoClient) refreshDIToken(ctx context.Context, refreshToken, clientID string) (*OAuth2Token, error) {
	return s.postDIToken(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {clientID},
		"refresh_token": {refreshToken},
	}, clientID)
}

func (s *ssoClient) postDIToken(ctx context.Context, form url.Values, fallbackClientID string) (*OAuth2Token, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.diTokenURL(), strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}

	clientID := form.Get("client_id")
	if clientID == "" {
		clientID = fallbackClientID
	}
	applyNativeHeaders(req)
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(clientID+":")))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json,text/html;q=0.9,*/*;q=0.8")
	req.Header.Set("Cache-Control", "no-cache")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, errors.New("DI token exchange rate limited (429)")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("DI token exchange failed for %s: %s - %s", clientID, resp.Status, truncate(string(body), 200))
	}

	var tokenResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
		Scope        string `json:"scope"`
		TokenType    string `json:"token_type"`
	}
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("failed to parse DI token response: %w", err)
	}
	if tokenResp.AccessToken == "" {
		return nil, errors.New("DI token response missing access_token")
	}

	expiry := time.Now().Add(time.Hour)
	if tokenResp.ExpiresIn > 0 {
		expiry = time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	} else if exp, ok := jwtExpiry(tokenResp.AccessToken); ok {
		expiry = exp
	}

	resolvedClientID := jwtClientID(tokenResp.AccessToken)
	if resolvedClientID == "" {
		resolvedClientID = clientID
	}

	return &OAuth2Token{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		Expiry:       expiry,
		Scope:        tokenResp.Scope,
		TokenType:    tokenResp.TokenType,
		ClientID:     resolvedClientID,
	}, nil
}

func applyNativeHeaders(req *http.Request) {
	req.Header.Set("User-Agent", nativeAPIUA)
	req.Header.Set("X-Garmin-User-Agent", nativeXGarminUA)
	req.Header.Set("X-Garmin-Paired-App-Version", "10861")
	req.Header.Set("X-Garmin-Client-Platform", "Android")
	req.Header.Set("X-App-Ver", "10861")
	req.Header.Set("X-Lang", "en")
	req.Header.Set("X-GCExperience", "GC5")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
}

func jwtClientID(token string) string {
	payload, ok := jwtPayload(token)
	if !ok {
		return ""
	}
	if v, ok := payload["client_id"].(string); ok {
		return v
	}
	return ""
}

func jwtExpiry(token string) (time.Time, bool) {
	payload, ok := jwtPayload(token)
	if !ok {
		return time.Time{}, false
	}
	switch v := payload["exp"].(type) {
	case float64:
		return time.Unix(int64(v), 0), true
	case json.Number:
		n, err := v.Int64()
		if err != nil {
			return time.Time{}, false
		}
		return time.Unix(n, 0), true
	default:
		return time.Time{}, false
	}
}

func jwtPayload(token string) (map[string]any, bool) {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return nil, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		// Some tokens use padded encoding.
		raw, err = base64.URLEncoding.DecodeString(parts[1])
		if err != nil {
			return nil, false
		}
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, false
	}
	return payload, true
}

func (s *ssoClient) doSSOJSON(ctx context.Context, method, reqURL string, payload any) ([]byte, int, error) { //nolint:gocritic // unnamed status int is conventional
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, err
	}
	req, err := http.NewRequestWithContext(ctx, method, reqURL, bytes.NewReader(raw))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("User-Agent", iosLoginUA)
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://sso."+s.domain)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// Login authenticates the client with email and password
func (c *Client) Login(ctx context.Context, email, password string) error {
	return c.ssoLogin(ctx, email, password)
}
