package ghealth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2"
)

const defaultBaseURL = "https://health.googleapis.com"

// CoreScopes are the readonly Google Health OAuth scopes for MVP tools.
var CoreScopes = []string{
	"https://www.googleapis.com/auth/googlehealth.sleep.readonly",
	"https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
	"https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
	"https://www.googleapis.com/auth/googlehealth.profile.readonly",
}

// nowFn is overridable in tests for civil-date defaults.
var nowFn = time.Now

// Client talks to Google Health API (health.googleapis.com/v4).
type Client struct {
	ClientID     string
	ClientSecret string
	TokenPath    string
	BaseURL      string
	HTTPClient   *http.Client
	AccessToken  string // set after load; empty until auth

	// PreferWearables limits reconcile to Fitbit / Pixel Watch trackers (default true).
	PreferWearables bool

	mu    *sync.Mutex
	token *oauth2.Token
}

// MaybeFromEnv always returns a client; tokens may be missing.
func MaybeFromEnv() *Client {
	base := strings.TrimSpace(os.Getenv("GOOGLE_HEALTH_BASE_URL"))
	if base == "" {
		base = defaultBaseURL
	}
	c := &Client{
		ClientID:        strings.TrimSpace(os.Getenv("GOOGLE_HEALTH_CLIENT_ID")),
		ClientSecret:    strings.TrimSpace(os.Getenv("GOOGLE_HEALTH_CLIENT_SECRET")),
		TokenPath:       strings.TrimSpace(os.Getenv("GOOGLE_HEALTH_TOKEN_PATH")),
		BaseURL:         strings.TrimRight(base, "/"),
		HTTPClient:      &http.Client{Timeout: 30 * time.Second},
		PreferWearables: true,
		mu:              &sync.Mutex{},
	}
	if c.TokenPath == "" {
		c.TokenPath = DefaultTokenPath()
	}
	_ = c.LoadToken() // best-effort; missing file is fine at boot
	return c
}

func (c *Client) requireAuth() error {
	if c == nil {
		return errors.New("google health client not configured")
	}
	if strings.TrimSpace(c.AccessToken) == "" {
		return errors.New("google health auth required — run google-health-mcp auth (or gantry auth ghealth)")
	}
	return nil
}

// dataPointsURL builds .../v4/users/me/dataTypes/{type}/dataPoints[:suffix]
func (c *Client) dataPointsURL(dataType, suffix string) string {
	u := c.BaseURL + "/v4/users/me/dataTypes/" + dataType + "/dataPoints"
	if suffix != "" {
		u += ":" + suffix
	}
	return u
}

func (c *Client) wearables() bool {
	if c == nil {
		return true
	}
	return c.PreferWearables
}

func (c *Client) SleepGet(ctx context.Context, req SleepGetRequest) (*SleepListResult, error) {
	filter, err := filterSleepWindow(req.Date, req.AfterDate, req.BeforeDate, nowFn())
	if err != nil {
		return nil, err
	}
	// exercise/sleep reconcile pages are max 25. Follow tokens inside the tool
	// so a multi-night window is one agent call (8 pages ≈ 200 sessions).
	resp, err := c.reconcilePages(ctx, reconcileOpts{
		DataType:      DataTypeSleep,
		Filter:        filter,
		PageSize:      25,
		WearablesOnly: c.wearables(),
	}, 8)
	if err != nil {
		return nil, err
	}
	sessions := mapSleepSessions(decodePoints(resp.DataPoints))
	note := sleepAPINote
	if resp.NextPageToken != "" {
		note = "truncated; narrow after_date/before_date. " + note
	}
	if len(sessions) == 0 {
		return &SleepListResult{
			Sessions: []SleepResult{},
			Count:    0,
			Note:     "no sleep sessions in range. " + note,
		}, nil
	}
	return &SleepListResult{Sessions: sessions, Count: len(sessions), Note: note}, nil
}

func (c *Client) ActivitiesList(ctx context.Context, req ActivitiesListRequest) (*ActivitiesListResult, error) {
	filter, err := filterSessionRange("exercise", req.AfterDate, req.BeforeDate, nowFn())
	if err != nil {
		return nil, err
	}
	pageSize := req.Limit
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 25 {
		pageSize = 25
	}
	resp, err := c.reconcileDataPoints(ctx, reconcileOpts{
		DataType:      DataTypeExercise,
		Filter:        filter,
		PageSize:      pageSize,
		PageToken:     req.PageToken,
		WearablesOnly: c.wearables(),
	})
	if err != nil {
		return nil, err
	}
	acts := make([]Activity, 0, len(resp.DataPoints))
	for _, raw := range resp.DataPoints {
		m, err := decodeDataPoint(raw)
		if err != nil {
			continue
		}
		acts = append(acts, mapExercise(m))
	}
	return &ActivitiesListResult{
		Activities:    acts,
		Count:         len(acts),
		NextPageToken: resp.NextPageToken,
		Note:          "exercise via dataPoints:reconcile",
	}, nil
}

func (c *Client) ActivitiesGet(ctx context.Context, id string) (*Activity, error) {
	m, err := c.getDataPoint(ctx, id)
	if err != nil {
		return nil, err
	}
	a := mapExercise(m)
	return &a, nil
}

func (c *Client) HeartRateGet(ctx context.Context, req HeartRateRequest) (*HeartRateListResult, error) {
	filter, err := filterDailyWindow("daily_resting_heart_rate", req.Date, req.AfterDate, req.BeforeDate, nowFn())
	if err != nil {
		return nil, err
	}
	resp, err := c.reconcilePages(ctx, reconcileOpts{
		DataType:      DataTypeDailyRestingHeartRate,
		Filter:        filter,
		PageSize:      500,
		WearablesOnly: c.wearables(),
	}, 3)
	if err != nil {
		return nil, err
	}
	return mapRestingHRList(decodePoints(resp.DataPoints), resp.NextPageToken != ""), nil
}

func (c *Client) HRVGet(ctx context.Context, req HRVRequest) (*HRVListResult, error) {
	filter, err := filterDailyWindow("daily_heart_rate_variability", req.Date, req.AfterDate, req.BeforeDate, nowFn())
	if err != nil {
		return nil, err
	}
	resp, err := c.reconcilePages(ctx, reconcileOpts{
		DataType:      DataTypeDailyHeartRateVariability,
		Filter:        filter,
		PageSize:      500,
		WearablesOnly: c.wearables(),
	}, 3)
	if err != nil {
		return nil, err
	}
	return mapHRVList(decodePoints(resp.DataPoints), resp.NextPageToken != ""), nil
}

func (c *Client) WeightGet(ctx context.Context, req WeightRequest) (*WeightResult, error) {
	filter, err := filterWeightPeriod(req.BaseDate, req.Period, nowFn())
	if err != nil {
		return nil, err
	}
	resp, err := c.reconcilePages(ctx, reconcileOpts{
		DataType:      DataTypeWeight,
		Filter:        filter,
		PageSize:      100,
		WearablesOnly: false, // scales are often google-sources / manual
	}, 10)
	if err != nil {
		return nil, err
	}
	note := "weight via dataPoints:reconcile"
	if resp.NextPageToken != "" {
		note = "truncated; use a shorter period. " + note
	}
	return &WeightResult{
		Entries: mapWeightEntries(decodePoints(resp.DataPoints)),
		Note:    note,
	}, nil
}

func (c *Client) ProfileGet(ctx context.Context) (*Profile, error) {
	body, err := c.doGET(ctx, c.BaseURL+"/v4/users/me/identity", nil)
	if err != nil {
		return nil, err
	}
	var id struct {
		Name         string `json:"name"`
		LegacyUserID string `json:"legacyUserId"`
		HealthUserID string `json:"healthUserId"`
	}
	if err := json.Unmarshal(body, &id); err != nil {
		return nil, fmt.Errorf("decode identity: %w", err)
	}
	return &Profile{
		FitbitUser: id.LegacyUserID,
		GoogleUser: id.HealthUserID,
		Note:       "from users/me/identity (Google Health profile has no display name)",
	}, nil
}

// AccountStatus describes auth without calling the API (when possible).
func (c *Client) AccountStatus() map[string]any {
	authed := c != nil && strings.TrimSpace(c.AccessToken) != ""
	tokenPath := ""
	base := defaultBaseURL
	hasRefresh := false
	preferWearables := false
	if c != nil {
		tokenPath = c.TokenPath
		preferWearables = c.PreferWearables
		if c.BaseURL != "" {
			base = c.BaseURL
		}
		c.tokenMu().Lock()
		if c.token != nil && c.token.RefreshToken != "" {
			hasRefresh = true
		}
		c.tokenMu().Unlock()
	}
	return map[string]any{
		"provider":          "Google Health API",
		"base_url":          base,
		"authenticated":     authed,
		"client_id_set":     c != nil && c.ClientID != "",
		"token_path":        tokenPath,
		"has_refresh_token": hasRefresh,
		"prefer_wearables":  preferWearables,
		"scopes":            CoreScopes,
		"docs_url":          "https://developers.google.com/health/about",
		"implementation":    "live health.googleapis.com/v4 reconcile",
		"boot_note":         "Missing tokens do not prevent MCP initialize; data tools error until auth.",
		"host_id":           "ghealth",
	}
}
