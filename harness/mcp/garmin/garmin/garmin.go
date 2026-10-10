// Package garmin provides a Go client library for interacting with Garmin services.
package garmin

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
)

// SessionPersister writes updated auth state after a successful token refresh.
// Typical CLI/MCP usage: save session.json so rotated refresh tokens survive restarts.
type SessionPersister func(*Client) error

const (
	defaultDomain = "garmin.com"
)

// Options configures the Garmin client.
type Options struct {
	HTTPClient *http.Client
	MFAHandler func() (string, error)
	RateLimit  *RateLimitConfig
	Retry      *RetryConfig // nil uses DefaultRetryConfig (short, MCP-friendly)
	Domain     string       // "garmin.com" or "garmin.cn"
}

// Client is the main entry point for interacting with Garmin services.
type Client struct {
	Sleep           *SleepService
	Wellness        *WellnessService
	Activities      *ActivityService
	Metrics         *MetricsService
	Weight          *WeightService
	Devices         *DeviceService
	Workouts        *WorkoutService
	Goals           *GoalService
	Badges          *BadgeService
	Gear            *GearService
	Download        *DownloadService
	Upload          *UploadService
	Hydration       *HydrationService
	BloodPressure   *BloodPressureService
	PersonalRecords *PersonalRecordsService
	Steps           *StepsService
	UserProfile     *UserProfileService
	HRV             *HRVService
	Biometric       *BiometricService
	Calendar        *CalendarService
	FitnessAge      *FitnessAgeService
	FitnessStats    *FitnessStatsService
	Courses         *CourseService
	UserSummary     *UserSummaryService
	TrainingPlans   *TrainingPlanService
	Lifestyle       *LifestyleService
	PeriodicHealth  *PeriodicHealthService
	Golf            *GolfService

	opts             Options
	transport        *httpTransport
	auth             *authState
	sessionPersister SessionPersister
}

// New creates a new Garmin client with the provided options.
func New(opts Options) *Client {
	if opts.Domain == "" {
		opts.Domain = defaultDomain
	}

	rlConfig := DefaultRateLimitConfig()
	if opts.RateLimit != nil {
		rlConfig = *opts.RateLimit
	}
	retryConfig := DefaultRetryConfig()
	if opts.Retry != nil {
		retryConfig = *opts.Retry
	}

	c := &Client{
		opts:      opts,
		transport: newHTTPTransport(opts.HTTPClient, retryConfig, newRateLimiter(rlConfig)),
		auth:      &authState{Domain: opts.Domain},
	}

	// Initialize services
	c.Sleep = &SleepService{client: c}
	c.Wellness = &WellnessService{client: c}
	c.Activities = &ActivityService{client: c}
	c.Metrics = &MetricsService{client: c}
	c.Weight = &WeightService{client: c}
	c.Devices = &DeviceService{client: c}
	c.Workouts = &WorkoutService{client: c}
	c.Goals = &GoalService{client: c}
	c.Badges = &BadgeService{client: c}
	c.Gear = &GearService{client: c}
	c.Download = &DownloadService{client: c}
	c.Upload = &UploadService{client: c}
	c.Hydration = &HydrationService{client: c}
	c.BloodPressure = &BloodPressureService{client: c}
	c.PersonalRecords = &PersonalRecordsService{client: c}
	c.Steps = &StepsService{client: c}
	c.UserProfile = &UserProfileService{client: c}
	c.HRV = &HRVService{client: c}
	c.Biometric = &BiometricService{client: c}
	c.Calendar = &CalendarService{client: c}
	c.FitnessAge = &FitnessAgeService{client: c}
	c.FitnessStats = &FitnessStatsService{client: c}
	c.Courses = &CourseService{client: c}
	c.UserSummary = &UserSummaryService{client: c}
	c.TrainingPlans = &TrainingPlanService{client: c}
	c.Lifestyle = &LifestyleService{client: c}
	c.PeriodicHealth = &PeriodicHealthService{client: c}
	c.Golf = &GolfService{client: c}

	return c
}

// SaveSession persists the authentication state to the provided writer.
func (c *Client) SaveSession(w io.Writer) error {
	return c.auth.save(w)
}

// LoadSession restores the authentication state from the provided reader.
func (c *Client) LoadSession(r io.Reader) error {
	return c.auth.load(r)
}

// SetSessionPersister registers a callback invoked after a successful token
// refresh so rotated tokens can be written to disk (e.g. session.json).
func (c *Client) SetSessionPersister(fn SessionPersister) {
	c.sessionPersister = fn
}

func (c *Client) persistSession() error {
	if c.sessionPersister == nil {
		return nil
	}
	return c.sessionPersister(c)
}

func (c *Client) ensureAuth(ctx context.Context) error {
	if !c.auth.isAuthenticated() {
		return ErrNotAuthenticated
	}
	if c.auth.isExpired() {
		return c.refreshOAuth2(ctx)
	}
	return nil
}

// ResolveDisplayName returns override when set, otherwise the current user's
// social profile display name (needed by some wellness chart endpoints).
func (c *Client) ResolveDisplayName(ctx context.Context, override string) (string, error) {
	if override != "" {
		return override, nil
	}
	profile, err := c.UserProfile.GetSocialProfile(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to get display name: %w", err)
	}
	if profile.DisplayName == "" {
		return "", errors.New("social profile has empty display name")
	}
	return profile.DisplayName, nil
}

func (c *Client) readBodyBytes(body io.Reader) ([]byte, error) {
	if body == nil || body == http.NoBody {
		return nil, nil
	}
	return io.ReadAll(body)
}

func (c *Client) bodyReader(bodyBytes []byte) io.Reader {
	if bodyBytes == nil {
		return http.NoBody
	}
	return bytes.NewReader(bodyBytes)
}

// doAPI performs an authenticated API request to Garmin Connect.
// Refreshes the access token when expired and retries once on HTTP 401.
//
//nolint:unparam // method will be used for POST/PUT/DELETE in future service implementations
func (c *Client) doAPI(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	if err := c.ensureAuth(ctx); err != nil {
		return nil, err
	}

	bodyBytes, err := c.readBodyBytes(body)
	if err != nil {
		return nil, err
	}

	resp, err := c.doAPIOnce(ctx, method, path, c.bodyReader(bodyBytes), false)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusUnauthorized {
		return resp, nil
	}

	_, _ = io.Copy(io.Discard, resp.Body)
	resp.Body.Close()

	if err := c.refreshOAuth2(ctx); err != nil {
		return nil, err
	}
	return c.doAPIOnce(ctx, method, path, c.bodyReader(bodyBytes), false)
}

// doAPIWithBody performs an authenticated API request with a JSON body.
func (c *Client) doAPIWithBody(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	if err := c.ensureAuth(ctx); err != nil {
		return nil, err
	}

	bodyBytes, err := c.readBodyBytes(body)
	if err != nil {
		return nil, err
	}

	resp, err := c.doAPIOnce(ctx, method, path, c.bodyReader(bodyBytes), true)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusUnauthorized {
		return resp, nil
	}

	_, _ = io.Copy(io.Discard, resp.Body)
	resp.Body.Close()

	if err := c.refreshOAuth2(ctx); err != nil {
		return nil, err
	}
	return c.doAPIOnce(ctx, method, path, c.bodyReader(bodyBytes), true)
}

func (c *Client) doAPIOnce(ctx context.Context, method, path string, body io.Reader, jsonBody bool) (*http.Response, error) {
	url := fmt.Sprintf("https://connectapi.%s%s", c.auth.Domain, path)
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}

	applyAPIAuthHeaders(req, c.auth.OAuth2AccessToken)
	if jsonBody {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("nk", "NT")
	}

	return c.transport.do(req)
}

// doAPIMultipart performs an authenticated multipart/form-data upload.
func (c *Client) doAPIMultipart(ctx context.Context, path, fieldName, fileName string, content io.Reader) (*http.Response, error) {
	if err := c.ensureAuth(ctx); err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile(fieldName, fileName)
	if err != nil {
		return nil, fmt.Errorf("create form file: %w", err)
	}
	if _, err := io.Copy(part, content); err != nil {
		return nil, fmt.Errorf("copy content: %w", err)
	}
	if err := w.Close(); err != nil {
		return nil, fmt.Errorf("close multipart writer: %w", err)
	}
	bodyBytes := buf.Bytes()
	contentType := w.FormDataContentType()

	resp, err := c.doAPIMultipartOnce(ctx, path, bodyBytes, contentType)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusUnauthorized {
		return resp, nil
	}

	_, _ = io.Copy(io.Discard, resp.Body)
	resp.Body.Close()

	if err := c.refreshOAuth2(ctx); err != nil {
		return nil, err
	}
	return c.doAPIMultipartOnce(ctx, path, bodyBytes, contentType)
}

func (c *Client) doAPIMultipartOnce(ctx context.Context, path string, bodyBytes []byte, contentType string) (*http.Response, error) {
	url := fmt.Sprintf("https://connectapi.%s%s", c.auth.Domain, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}

	applyAPIAuthHeaders(req, c.auth.OAuth2AccessToken)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("nk", "NT")

	return c.transport.do(req)
}

func applyAPIAuthHeaders(req *http.Request, accessToken string) {
	applyNativeHeaders(req)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
}

// refreshOAuth2 refreshes the DI bearer token using the stored refresh token
// and persists the updated session when a SessionPersister is configured.
func (c *Client) refreshOAuth2(ctx context.Context) error {
	if c.auth.OAuth2RefreshToken == "" || c.auth.DIClientID == "" {
		return fmt.Errorf("%w: missing DI refresh token or client id", ErrSessionExpired)
	}

	sso, err := newSSOClient(c.auth.Domain, c.transport.client.Timeout, c.transport.client)
	if err != nil {
		return err
	}

	oauth2, err := sso.refreshDIToken(ctx, c.auth.OAuth2RefreshToken, c.auth.DIClientID)
	if err != nil {
		return fmt.Errorf("%w: %w", ErrSessionExpired, err)
	}

	return c.commitOAuth2(oauth2)
}

// commitOAuth2 applies a new DI token set and persists the session when configured.
func (c *Client) commitOAuth2(oauth2 *OAuth2Token) error {
	c.auth.OAuth2AccessToken = oauth2.AccessToken
	if oauth2.RefreshToken != "" {
		c.auth.OAuth2RefreshToken = oauth2.RefreshToken
	}
	c.auth.OAuth2Expiry = oauth2.Expiry
	c.auth.OAuth2Scope = oauth2.Scope
	if oauth2.ClientID != "" {
		c.auth.DIClientID = oauth2.ClientID
	}

	if err := c.persistSession(); err != nil {
		return fmt.Errorf("token refreshed but failed to persist session: %w", err)
	}
	return nil
}
