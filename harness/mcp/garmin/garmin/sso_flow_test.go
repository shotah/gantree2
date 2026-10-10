package garmin

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestAuthenticateStart(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name       string
		status     int
		body       string
		cookie     bool
		rtErr      error
		readErr    bool
		wantTicket string
		wantMethod string
		wantErr    string
	}{
		{name: "success", status: http.StatusOK, body: `{"responseStatus":{"type":"SUCCESSFUL"},"serviceTicketId":"ST-1"}`, wantTicket: "ST-1"},
		{name: "empty ticket", status: http.StatusOK, body: `{"responseStatus":{"type":"SUCCESSFUL"}}`, wantErr: "empty service ticket"},
		{name: "mfa phone", status: http.StatusOK, body: `{"responseStatus":{"type":"MFA_REQUIRED"},"customerMfaInfo":{"mfaLastMethodUsed":"phone"}}`, cookie: true, wantMethod: "phone"},
		{name: "mfa email", status: http.StatusOK, body: `{"responseStatus":{"type":"MFA_REQUIRED"}}`, wantMethod: "email"},
		{name: "bad password", status: http.StatusOK, body: `{"responseStatus":{"type":"INVALID_USERNAME_PASSWORD"}}`, wantErr: "invalid username"},
		{name: "captcha", status: http.StatusOK, body: `{"responseStatus":{"type":"CAPTCHA_REQUIRED"}}`, wantErr: "captcha"},
		{name: "message", status: http.StatusOK, body: `{"responseStatus":{"type":"LOCKED","message":"nope"}}`, wantErr: "LOCKED: nope"},
		{name: "empty status", status: http.StatusTeapot, body: `{"responseStatus":{}}`, wantErr: "HTTP 418"},
		{name: "http 429", status: http.StatusTooManyRequests, body: `{}`, wantErr: "429"},
		{name: "http 403", status: http.StatusForbidden, body: `{}`, wantErr: "403"},
		{name: "error status 429", status: http.StatusOK, body: `{"error":{"status-code":"429"}}`, wantErr: "429"},
		{name: "bad json", status: http.StatusOK, body: `not-json`, wantErr: "parse mobile login"},
		{name: "transport", rtErr: errors.New("dial"), wantErr: "submit mobile login"},
		{name: "read body", status: http.StatusOK, readErr: true, wantErr: "read failed"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sso := scriptSSO(t, "garmin.com", func(r *http.Request) (*http.Response, error) {
				if !strings.Contains(r.URL.Host, "sso.garmin.com") {
					t.Fatalf("host %s", r.URL.Host)
				}
				if tc.rtErr != nil {
					return nil, tc.rtErr
				}
				if tc.readErr {
					return &http.Response{StatusCode: tc.status, Header: make(http.Header), Body: errReadCloser{}}, nil
				}
				resp := jsonResponse(tc.status, tc.body)
				if tc.cookie {
					resp.Header.Set("Set-Cookie", "SESSION=abc; Path=/")
				}
				return resp, nil
			})
			ticket, pending, err := sso.authenticateStart(ctx, "ada@example.com", "secret")
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("err=%v, want %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if ticket != tc.wantTicket {
				t.Fatalf("ticket %q", ticket)
			}
			if tc.wantMethod == "" {
				if pending != nil {
					t.Fatal("unexpected pending")
				}
				return
			}
			if pending == nil || pending.MFAMethod != tc.wantMethod || pending.Domain != "garmin.com" {
				t.Fatalf("pending %+v", pending)
			}
			if pending.LoginParams.Get("clientId") != iosSSOClientID {
				t.Fatalf("params %v", pending.LoginParams)
			}
		})
	}
}

func TestMobileMFAAndDIToken(t *testing.T) {
	ctx := context.Background()
	access := jwtToken(`{"client_id":"from-jwt","exp":1893456000}`)

	t.Run("authenticate success skips mfa", func(t *testing.T) {
		sso := scriptSSO(t, "garmin.com", func(*http.Request) (*http.Response, error) {
			return jsonResponse(http.StatusOK, `{"responseStatus":{"type":"SUCCESSFUL"},"serviceTicketId":"ST-9"}`), nil
		})
		ticket, err := sso.authenticate(ctx, "a", "b", nil)
		if err != nil || ticket != "ST-9" {
			t.Fatalf("ticket %q err=%v", ticket, err)
		}
	})

	t.Run("mfa handler missing", func(t *testing.T) {
		sso := scriptSSO(t, "garmin.com", func(*http.Request) (*http.Response, error) {
			return jsonResponse(http.StatusOK, `{"responseStatus":{"type":"MFA_REQUIRED"}}`), nil
		})
		_, err := sso.authenticate(ctx, "a", "b", nil)
		if !errors.Is(err, ErrMFARequired) {
			t.Fatalf("err=%v", err)
		}
	})

	t.Run("mfa handler error", func(t *testing.T) {
		sso := scriptSSO(t, "garmin.com", func(*http.Request) (*http.Response, error) {
			return jsonResponse(http.StatusOK, `{"responseStatus":{"type":"MFA_REQUIRED"}}`), nil
		})
		_, err := sso.authenticate(ctx, "a", "b", func() (string, error) {
			return "", errors.New("no code")
		})
		if err == nil || !strings.Contains(err.Error(), "MFA handler failed") {
			t.Fatalf("err=%v", err)
		}
	})

	t.Run("mfa success", func(t *testing.T) {
		sso := scriptSSO(t, "garmin.com", func(r *http.Request) (*http.Response, error) {
			if strings.Contains(r.URL.Path, "verifyCode") {
				return jsonResponse(http.StatusOK, `{"responseStatus":{"type":"SUCCESSFUL"},"serviceTicketId":"ST-mfa"}`), nil
			}
			return jsonResponse(http.StatusOK, `{"responseStatus":{"type":"MFA_REQUIRED"},"customerMfaInfo":{"mfaLastMethodUsed":"email"}}`), nil
		})
		ticket, err := sso.authenticate(ctx, "a", "b", func() (string, error) { return "123456", nil })
		if err != nil || ticket != "ST-mfa" {
			t.Fatalf("ticket %q err=%v", ticket, err)
		}
	})

	mfaCases := []struct {
		name    string
		status  int
		body    string
		rtErr   error
		readErr bool
		wantErr string
		want    string
	}{
		{name: "ok", status: http.StatusOK, body: `{"responseStatus":{"type":"SUCCESSFUL"},"serviceTicketId":"ST-2"}`, want: "ST-2"},
		{name: "failed type", status: http.StatusOK, body: `{"responseStatus":{"type":"INVALID","message":"bad"}}`, wantErr: "MFA failed"},
		{name: "empty ticket", status: http.StatusOK, body: `{"responseStatus":{"type":"SUCCESSFUL"}}`, wantErr: "MFA failed"},
		{name: "bad json", status: http.StatusOK, body: `{`, wantErr: "parse MFA"},
		{name: "transport", rtErr: errors.New("dial"), wantErr: "submit MFA"},
		{name: "read", status: http.StatusOK, readErr: true, wantErr: "read failed"},
	}
	for _, tc := range mfaCases {
		t.Run("submit "+tc.name, func(t *testing.T) {
			sso := scriptSSO(t, "garmin.cn", func(r *http.Request) (*http.Response, error) {
				if !strings.Contains(r.URL.Host, "sso.garmin.cn") {
					t.Fatalf("host %s", r.URL.Host)
				}
				if tc.rtErr != nil {
					return nil, tc.rtErr
				}
				if tc.readErr {
					return &http.Response{StatusCode: tc.status, Header: make(http.Header), Body: errReadCloser{}}, nil
				}
				return jsonResponse(tc.status, tc.body), nil
			})
			if sso.serviceURL() != "https://mobile.integration.garmin.cn/gcm/ios" {
				t.Fatalf("service %s", sso.serviceURL())
			}
			ticket, err := sso.submitMobileMFA(ctx, url.Values{"service": {"https://example"}}, "email", "999")
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("err=%v", err)
				}
				return
			}
			if err != nil || ticket != tc.want {
				t.Fatalf("ticket %q err=%v", ticket, err)
			}
		})
	}

	t.Run("token expires_in and jwt client", func(t *testing.T) {
		sso := scriptSSO(t, "garmin.com", func(*http.Request) (*http.Response, error) {
			return jsonResponse(http.StatusOK, `{"access_token":"`+access+`","refresh_token":"r","expires_in":120,"scope":"s","token_type":"bearer"}`), nil
		})
		token, err := sso.postDIToken(ctx, url.Values{"client_id": {"sent"}}, "fallback")
		if err != nil {
			t.Fatal(err)
		}
		if token.ClientID != "from-jwt" || token.RefreshToken != "r" || token.Scope != "s" {
			t.Fatalf("%+v", token)
		}
		if time.Until(token.Expiry) < time.Minute || time.Until(token.Expiry) > 3*time.Minute {
			t.Fatalf("expiry %s", token.Expiry)
		}
	})

	t.Run("token jwt expiry when expires_in is zero", func(t *testing.T) {
		sso := scriptSSO(t, "garmin.com", func(*http.Request) (*http.Response, error) {
			return jsonResponse(http.StatusOK, `{"access_token":"`+access+`","expires_in":0}`), nil
		})
		token, err := sso.refreshDIToken(ctx, "refresh", "client")
		if err != nil || token.Expiry.Unix() != 1893456000 {
			t.Fatalf("%+v err=%v", token, err)
		}
	})

	t.Run("token fallback client id", func(t *testing.T) {
		sso := scriptSSO(t, "garmin.com", func(*http.Request) (*http.Response, error) {
			return jsonResponse(http.StatusOK, `{"access_token":"plain","expires_in":30}`), nil
		})
		token, err := sso.postDIToken(ctx, url.Values{}, "fallback-id")
		if err != nil || token.ClientID != "fallback-id" || token.AccessToken != "plain" {
			t.Fatalf("%+v err=%v", token, err)
		}
	})

	tokenErrs := []struct {
		name    string
		status  int
		body    string
		rtErr   error
		readErr bool
		wantErr string
	}{
		{name: "missing access", status: http.StatusOK, body: `{"refresh_token":"r"}`, wantErr: "missing access_token"},
		{name: "429", status: http.StatusTooManyRequests, body: `slow`, wantErr: "429"},
		{name: "status", status: http.StatusBadRequest, body: `nope`, wantErr: "DI token exchange failed"},
		{name: "bad json", status: http.StatusOK, body: `{`, wantErr: "parse DI token"},
		{name: "transport", rtErr: errors.New("dial"), wantErr: "dial"},
		{name: "read", status: http.StatusOK, readErr: true, wantErr: "read failed"},
	}
	for _, tc := range tokenErrs {
		t.Run("token "+tc.name, func(t *testing.T) {
			sso := scriptSSO(t, "garmin.com", func(*http.Request) (*http.Response, error) {
				if tc.rtErr != nil {
					return nil, tc.rtErr
				}
				if tc.readErr {
					return &http.Response{StatusCode: tc.status, Status: "200 OK", Header: make(http.Header), Body: errReadCloser{}}, nil
				}
				return jsonResponse(tc.status, tc.body), nil
			})
			_, err := sso.postDIToken(ctx, url.Values{"client_id": {"c"}}, "c")
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("err=%v, want %q", err, tc.wantErr)
			}
		})
	}

	t.Run("exchange retries client ids", func(t *testing.T) {
		var n int
		sso := scriptSSO(t, "garmin.com", func(*http.Request) (*http.Response, error) {
			n++
			if n == 1 {
				return jsonResponse(http.StatusUnauthorized, "no"), nil
			}
			return jsonResponse(http.StatusOK, `{"access_token":"ok","expires_in":60}`), nil
		})
		token, err := sso.exchangeServiceTicket(ctx, "ST", sso.serviceURL())
		if err != nil || token.AccessToken != "ok" || n != 2 {
			t.Fatalf("token %+v n=%d err=%v", token, n, err)
		}
	})

	t.Run("exchange all fail", func(t *testing.T) {
		var n int
		sso := scriptSSO(t, "garmin.com", func(*http.Request) (*http.Response, error) {
			n++
			return jsonResponse(http.StatusUnauthorized, "no"), nil
		})
		_, err := sso.exchangeServiceTicket(ctx, "ST", sso.serviceURL())
		if err == nil || n != len(diClientIDs) {
			t.Fatalf("n=%d err=%v", n, err)
		}
	})

	t.Run("marshal error and constructors", func(t *testing.T) {
		sso := scriptSSO(t, "garmin.com", func(*http.Request) (*http.Response, error) {
			t.Fatal("request")
			return nil, nil
		})
		if _, _, err := sso.doSSOJSON(ctx, http.MethodPost, "https://sso.garmin.com/x", make(chan int)); err == nil {
			t.Fatal("expected marshal error")
		}
		bare, err := newSSOClient("garmin.com", time.Second, nil)
		if err != nil || bare.httpClient == nil || bare.serviceURL() == "" {
			t.Fatal(err)
		}
		withJar, err := newSSOClientWithJar("garmin.com", time.Second, nil, nil)
		if err != nil || withJar.httpClient.Jar == nil {
			t.Fatal(err)
		}
		if dumpSSOCookies(nil, "garmin.com") != nil {
			t.Fatal("nil jar")
		}
	})

	t.Run("padded jwt", func(t *testing.T) {
		raw := []byte(`{"client_id":"p","exp":10}`)
		padded := base64.URLEncoding.EncodeToString(raw)
		if !strings.Contains(padded, "=") {
			t.Fatalf("payload %q encoded %q without padding", raw, padded)
		}
		token := "h." + padded + ".s"
		if jwtClientID(token) != "p" {
			t.Fatalf("client id %q", jwtClientID(token))
		}
		exp, ok := jwtExpiry(token)
		if !ok || exp.Unix() != 10 {
			t.Fatalf("exp %v ok=%v", exp, ok)
		}
	})
}

func TestLoginAndChatExchange(t *testing.T) {
	ctx := context.Background()
	access := jwtToken(`{"client_id":"from-jwt","exp":1893456000}`)
	tokenBody := `{"access_token":"` + access + `","refresh_token":"rotated","expires_in":3600,"scope":"CONNECT","token_type":"bearer"}`

	t.Run("login applies token", func(t *testing.T) {
		client := ssoClientFor(t, func(r *http.Request) (*http.Response, error) {
			switch {
			case strings.Contains(r.URL.Path, "/mobile/api/login"):
				return jsonResponse(http.StatusOK, `{"responseStatus":{"type":"SUCCESSFUL"},"serviceTicketId":"ST-login"}`), nil
			case strings.Contains(r.URL.Path, "/oauth/token"):
				return jsonResponse(http.StatusOK, tokenBody), nil
			default:
				t.Fatalf("unexpected %s", r.URL.String())
				return nil, nil
			}
		})
		if err := client.Login(ctx, "ada@example.com", "pw"); err != nil {
			t.Fatal(err)
		}
		if client.auth.OAuth2AccessToken != access || client.auth.OAuth2RefreshToken != "rotated" || client.auth.DIClientID != "from-jwt" {
			t.Fatalf("auth %+v", client.auth)
		}
	})

	t.Run("chat mfa then exchange", func(t *testing.T) {
		dir := t.TempDir()
		pendingPath := dir + "/mfa_pending.json"
		var stage string
		client := ssoClientFor(t, func(r *http.Request) (*http.Response, error) {
			switch {
			case strings.Contains(r.URL.Path, "/mobile/api/login"):
				resp := jsonResponse(http.StatusOK, `{"responseStatus":{"type":"MFA_REQUIRED"},"customerMfaInfo":{"mfaLastMethodUsed":"phone"}}`)
				resp.Header.Set("Set-Cookie", "SESSION=abc; Path=/")
				return resp, nil
			case strings.Contains(r.URL.Path, "verifyCode"):
				stage = "mfa"
				return jsonResponse(http.StatusOK, `{"responseStatus":{"type":"SUCCESSFUL"},"serviceTicketId":"ST-chat"}`), nil
			case strings.Contains(r.URL.Path, "/oauth/token"):
				return jsonResponse(http.StatusOK, tokenBody), nil
			default:
				t.Fatalf("unexpected %s", r.URL.String())
				return nil, nil
			}
		})
		required, method, err := client.ChatLoginStart(ctx, "ada@example.com", "pw", pendingPath)
		if err != nil || !required || method != "phone" {
			t.Fatalf("required=%v method=%s err=%v", required, method, err)
		}
		if err := client.ChatLoginExchange(ctx, pendingPath, " 123456 "); err != nil {
			t.Fatal(err)
		}
		if stage != "mfa" || client.auth.OAuth2AccessToken != access {
			t.Fatalf("stage %s auth %+v", stage, client.auth)
		}
		if _, err := LoadMFAPending(pendingPath); err == nil {
			t.Fatal("pending file still present")
		}
	})

	t.Run("chat success clears pending", func(t *testing.T) {
		dir := t.TempDir()
		pendingPath := dir + "/mfa_pending.json"
		if err := SaveMFAPending(pendingPath, &MFAPending{Domain: "garmin.com", MFAMethod: "email", ExpiresAt: time.Now().Add(time.Minute)}); err != nil {
			t.Fatal(err)
		}
		client := ssoClientFor(t, func(r *http.Request) (*http.Response, error) {
			if strings.Contains(r.URL.Path, "/oauth/token") {
				return jsonResponse(http.StatusOK, tokenBody), nil
			}
			return jsonResponse(http.StatusOK, `{"responseStatus":{"type":"SUCCESSFUL"},"serviceTicketId":"ST-direct"}`), nil
		})
		required, _, err := client.ChatLoginStart(ctx, "ada@example.com", "pw", pendingPath)
		if err != nil || required {
			t.Fatalf("required=%v err=%v", required, err)
		}
		if _, err := LoadMFAPending(pendingPath); err == nil {
			t.Fatal("pending not cleared")
		}
	})

	t.Run("exchange validation", func(t *testing.T) {
		client := ssoClientFor(t, func(*http.Request) (*http.Response, error) {
			t.Fatal("request")
			return nil, nil
		})
		if err := client.ChatLoginExchange(ctx, t.TempDir()+"/missing.json", "   "); err == nil || !strings.Contains(err.Error(), "empty MFA") {
			t.Fatalf("err=%v", err)
		}
		if err := client.ChatLoginExchange(ctx, t.TempDir()+"/missing.json", "123"); err == nil {
			t.Fatal("expected missing pending")
		}
	})

	t.Run("apply ticket with nil sso and exchange failure", func(t *testing.T) {
		client := ssoClientFor(t, func(r *http.Request) (*http.Response, error) {
			if strings.Contains(r.URL.Path, "/oauth/token") {
				return jsonResponse(http.StatusOK, tokenBody), nil
			}
			t.Fatalf("unexpected %s", r.URL.String())
			return nil, nil
		})
		if err := client.applyServiceTicket(ctx, nil, "ST"); err != nil {
			t.Fatal(err)
		}
		if client.auth.OAuth2AccessToken != access {
			t.Fatalf("auth %+v", client.auth)
		}

		failing := ssoClientFor(t, func(*http.Request) (*http.Response, error) {
			return jsonResponse(http.StatusUnauthorized, "no"), nil
		})
		err := failing.applyServiceTicket(ctx, nil, "ST")
		if err == nil || !strings.Contains(err.Error(), "exchange service ticket") {
			t.Fatalf("err=%v", err)
		}
	})
}

func TestRefreshRetryAndConsumer(t *testing.T) {
	ctx := context.Background()
	access := jwtToken(`{"client_id":"from-jwt","exp":1893456000}`)
	tokenBody := `{"access_token":"` + access + `","refresh_token":"rotated","expires_in":3600}`

	t.Run("expired token refreshes before the call", func(t *testing.T) {
		var persisted int
		client := ssoClientFor(t, func(r *http.Request) (*http.Response, error) {
			if strings.Contains(r.URL.Host, "diauth.") {
				return jsonResponse(http.StatusOK, tokenBody), nil
			}
			return jsonResponse(http.StatusOK, `{}`), nil
		})
		client.auth.OAuth2AccessToken = "old"
		client.auth.OAuth2RefreshToken = "refresh"
		client.auth.DIClientID = "client"
		client.auth.OAuth2Expiry = time.Now().Add(-time.Hour)
		client.SetSessionPersister(func(*Client) error {
			persisted++
			return nil
		})
		resp, err := client.doAPI(ctx, http.MethodGet, "/x", http.NoBody)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if persisted != 1 || client.auth.OAuth2AccessToken != access || client.auth.OAuth2RefreshToken != "rotated" {
			t.Fatalf("persisted %d auth %+v", persisted, client.auth)
		}
	})

	t.Run("401 retries once", func(t *testing.T) {
		var api int
		client := authedRefreshClient(t, func(r *http.Request) (*http.Response, error) {
			if strings.Contains(r.URL.Host, "diauth.") {
				return jsonResponse(http.StatusOK, tokenBody), nil
			}
			api++
			if api == 1 {
				return jsonResponse(http.StatusUnauthorized, "expired"), nil
			}
			return jsonResponse(http.StatusOK, `{"ok":true}`), nil
		})
		resp, err := client.doAPIWithBody(ctx, http.MethodPost, "/x", strings.NewReader(`{"a":1}`))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if api != 2 || resp.StatusCode != http.StatusOK {
			t.Fatalf("api=%d status=%d", api, resp.StatusCode)
		}
	})

	t.Run("multipart 401 retries", func(t *testing.T) {
		var api int
		client := authedRefreshClient(t, func(r *http.Request) (*http.Response, error) {
			if strings.Contains(r.URL.Host, "diauth.") {
				return jsonResponse(http.StatusOK, tokenBody), nil
			}
			api++
			if api == 1 {
				return jsonResponse(http.StatusUnauthorized, "expired"), nil
			}
			return jsonResponse(http.StatusOK, `{}`), nil
		})
		resp, err := client.doAPIMultipart(ctx, "/upload", "file", "a.gpx", strings.NewReader("<gpx/>"))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if api != 2 {
			t.Fatalf("api=%d", api)
		}
	})

	t.Run("missing refresh token", func(t *testing.T) {
		client := ssoClientFor(t, func(*http.Request) (*http.Response, error) {
			t.Fatal("request")
			return nil, nil
		})
		client.auth.OAuth2AccessToken = "old"
		client.auth.OAuth2Expiry = time.Now().Add(-time.Hour)
		if _, err := client.doAPI(ctx, http.MethodGet, "/x", http.NoBody); err == nil || !errors.Is(err, ErrSessionExpired) {
			t.Fatalf("err=%v", err)
		}
	})

	t.Run("401 refresh failure", func(t *testing.T) {
		client := authedRefreshClient(t, func(*http.Request) (*http.Response, error) {
			return jsonResponse(http.StatusUnauthorized, "no"), nil
		})
		client.auth.OAuth2RefreshToken = ""
		if _, err := client.doAPIMultipart(ctx, "/upload", "file", "a.gpx", strings.NewReader("x")); err == nil || !errors.Is(err, ErrSessionExpired) {
			t.Fatalf("err=%v", err)
		}
	})

	t.Run("persist failure", func(t *testing.T) {
		client := ssoClientFor(t, func(r *http.Request) (*http.Response, error) {
			if strings.Contains(r.URL.Host, "diauth.") {
				return jsonResponse(http.StatusOK, tokenBody), nil
			}
			return jsonResponse(http.StatusOK, `{}`), nil
		})
		client.auth.OAuth2AccessToken = "old"
		client.auth.OAuth2RefreshToken = "refresh"
		client.auth.DIClientID = "client"
		client.auth.OAuth2Expiry = time.Now().Add(-time.Hour)
		client.SetSessionPersister(func(*Client) error { return errors.New("disk") })
		if _, err := client.doAPI(ctx, http.MethodGet, "/x", nil); err == nil || !strings.Contains(err.Error(), "persist session") {
			t.Fatalf("err=%v", err)
		}
	})

	t.Run("commit keeps blank refresh and client id", func(t *testing.T) {
		client := New(Options{})
		client.auth.OAuth2RefreshToken = "keep"
		client.auth.DIClientID = "keep-id"
		if err := client.commitOAuth2(&OAuth2Token{AccessToken: "new", Expiry: time.Now().Add(time.Hour)}); err != nil {
			t.Fatal(err)
		}
		if client.auth.OAuth2RefreshToken != "keep" || client.auth.DIClientID != "keep-id" || client.auth.OAuth2AccessToken != "new" {
			t.Fatalf("%+v", client.auth)
		}
	})

	t.Run("oauth consumer", func(t *testing.T) {
		consumerMu.Lock()
		prev := cachedConsumer
		cachedConsumer = nil
		consumerMu.Unlock()
		t.Cleanup(func() {
			consumerMu.Lock()
			cachedConsumer = prev
			consumerMu.Unlock()
		})

		var hits int
		client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			hits++
			if r.URL.String() != oauthConsumerURL {
				t.Fatalf("url %s", r.URL.String())
			}
			return jsonResponse(http.StatusOK, `{"consumer_key":"k","consumer_secret":"s"}`), nil
		})}
		got, err := fetchOAuthConsumer(ctx, client)
		if err != nil || got.Key != "k" || got.Secret != "s" {
			t.Fatalf("%+v err=%v", got, err)
		}
		if _, err := fetchOAuthConsumer(ctx, client); err != nil || hits != 1 {
			t.Fatalf("hits %d err=%v", hits, err)
		}

		consumerMu.Lock()
		cachedConsumer = nil
		consumerMu.Unlock()
		_, err = fetchOAuthConsumer(ctx, &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return nil, errors.New("dial")
		})})
		if err == nil || !strings.Contains(err.Error(), "dial") {
			t.Fatalf("err=%v", err)
		}
		_, err = fetchOAuthConsumer(ctx, &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return jsonResponse(http.StatusOK, `{`), nil
		})})
		if err == nil {
			t.Fatal("expected json error")
		}
	})
}

func scriptSSO(t *testing.T, domain string, rt roundTripFunc) *ssoClient {
	t.Helper()
	sso, err := newSSOClient(domain, time.Second, &http.Client{Transport: rt})
	if err != nil {
		t.Fatal(err)
	}
	return sso
}

func ssoClientFor(t *testing.T, rt roundTripFunc) *Client {
	t.Helper()
	return New(Options{
		HTTPClient: &http.Client{Transport: rt},
		RateLimit:  &RateLimitConfig{RequestsPerMinute: 60000, BurstSize: 1000},
		Retry:      &RetryConfig{MaxRetries: 0, InitialBackoff: time.Millisecond, MaxBackoff: time.Millisecond},
	})
}

func authedRefreshClient(t *testing.T, rt roundTripFunc) *Client {
	t.Helper()
	client := ssoClientFor(t, rt)
	client.auth.OAuth2AccessToken = "old"
	client.auth.OAuth2RefreshToken = "refresh"
	client.auth.DIClientID = "client"
	client.auth.OAuth2Expiry = time.Now().Add(time.Hour)
	client.auth.Domain = "garmin.com"
	return client
}

func jwtToken(payload string) string {
	return "h." + base64.RawURLEncoding.EncodeToString([]byte(payload)) + ".s"
}
