package serpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const defaultBaseURL = "https://serpapi.com"

// Client talks to SerpAPI (Google Flights + autocomplete).
type Client struct {
	APIKey     string
	BaseURL    string
	HTTPClient *http.Client
}

// NewFromEnv builds a client from SERPAPI_API_KEY (required) and optional
// SERPAPI_BASE_URL (tests / proxies).
func NewFromEnv() (*Client, error) {
	key := strings.TrimSpace(os.Getenv("SERPAPI_API_KEY"))
	if key == "" {
		return nil, errors.New("SERPAPI_API_KEY is required")
	}
	base := strings.TrimSpace(os.Getenv("SERPAPI_BASE_URL"))
	if base == "" {
		base = defaultBaseURL
	}
	return &Client{
		APIKey:  key,
		BaseURL: strings.TrimRight(base, "/"),
		HTTPClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}, nil
}

// Usage is a lean SerpAPI quota snapshot (from the free Account API).
// Account checks do not count toward monthly search quota.
type Usage struct {
	SearchesUsed     int    `json:"searches_used"`
	SearchesLeft     int    `json:"searches_left"`
	SearchesPerMonth int    `json:"searches_per_month"`
	PlanRenewalDate  string `json:"plan_renewal_date,omitempty"`
	PlanName         string `json:"plan_name,omitempty"`
}

type rawAccountResponse struct {
	PlanName          string `json:"plan_name"`
	SearchesPerMonth  int    `json:"searches_per_month"`
	PlanSearchesLeft  int    `json:"plan_searches_left"`
	TotalSearchesLeft int    `json:"total_searches_left"`
	ThisMonthUsage    int    `json:"this_month_usage"`
	PlanRenewalDate   string `json:"plan_renewal_date"`
}

// Account fetches current SerpAPI usage. Free of charge (does not burn search quota).
func (c *Client) Account(ctx context.Context) (*Usage, error) {
	var raw rawAccountResponse
	if err := c.getJSON(ctx, "/account.json", nil, &raw); err != nil {
		return nil, err
	}
	left := raw.TotalSearchesLeft
	if left == 0 && raw.PlanSearchesLeft > 0 {
		left = raw.PlanSearchesLeft
	}
	return &Usage{
		SearchesUsed:     raw.ThisMonthUsage,
		SearchesLeft:     left,
		SearchesPerMonth: raw.SearchesPerMonth,
		PlanRenewalDate:  raw.PlanRenewalDate,
		PlanName:         raw.PlanName,
	}, nil
}

// usageOrNil fetches account usage; returns nil on failure so search results still win.
func (c *Client) usageOrNil(ctx context.Context) *Usage {
	u, err := c.Account(ctx)
	if err != nil {
		return nil
	}
	return u
}

// GetJSON performs a SerpAPI search and unmarshals into dest.
func (c *Client) GetJSON(ctx context.Context, params url.Values, dest any) error {
	return c.getJSON(ctx, "/search.json", params, dest)
}

func (c *Client) getJSON(ctx context.Context, path string, params url.Values, dest any) error {
	if c == nil {
		return errors.New("nil serpapi client")
	}
	if c.APIKey == "" {
		return errors.New("SERPAPI_API_KEY is required")
	}
	if params == nil {
		params = url.Values{}
	} else {
		// Copy so callers can reuse Values without api_key sticking around.
		copied := url.Values{}
		for k, vs := range params {
			copied[k] = append([]string(nil), vs...)
		}
		params = copied
	}
	params.Set("api_key", c.APIKey)
	base := c.BaseURL
	if base == "" {
		base = defaultBaseURL
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	endpoint := base + path + "?" + params.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, http.NoBody)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "flights-search-mcp/1.0")

	hc := c.HTTPClient
	if hc == nil {
		hc = http.DefaultClient
	}
	res, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close() //nolint:errcheck // best-effort close after read

	body, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("serpapi HTTP %d: %s", res.StatusCode, truncate(string(body), 400))
	}

	var envelope struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(body, &envelope)
	if envelope.Error != "" {
		return fmt.Errorf("serpapi: %s", envelope.Error)
	}
	if err := json.Unmarshal(body, dest); err != nil {
		return fmt.Errorf("decode serpapi response: %w", err)
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
