package ghealth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

type dataPointsResponse struct {
	DataPoints    []json.RawMessage `json:"dataPoints"`
	NextPageToken string            `json:"nextPageToken"`
}

// reconcileOpts controls dataPoints:reconcile queries.
type reconcileOpts struct {
	DataType         string
	Filter           string
	PageSize         int
	PageToken        string
	DataSourceFamily string // empty = google-wearables default for MVP
	WearablesOnly    bool   // when true (default) and family empty, use google-wearables
}

func (c *Client) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return http.DefaultClient
}

func (c *Client) doGET(ctx context.Context, rawURL string, query url.Values) ([]byte, error) {
	if err := c.ensureAccessToken(ctx); err != nil {
		return nil, err
	}
	u := rawURL
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, http.NoBody)
	if err != nil {
		return nil, err
	}
	c.tokenMu().Lock()
	token := c.AccessToken
	c.tokenMu().Unlock()
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("google health GET: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read google health response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(body))
		if len(msg) > 400 {
			msg = msg[:400] + "…"
		}
		return nil, fmt.Errorf("google health API %s: %s", resp.Status, msg)
	}
	return body, nil
}

func (c *Client) reconcileDataPoints(ctx context.Context, opts reconcileOpts) (*dataPointsResponse, error) {
	family := opts.DataSourceFamily
	if family == "" && opts.WearablesOnly {
		family = DataSourceFamilyGoogleWearables
	}
	q := url.Values{}
	if opts.Filter != "" {
		q.Set("filter", opts.Filter)
	}
	if family != "" {
		q.Set("dataSourceFamily", family)
	}
	if opts.PageSize > 0 {
		q.Set("pageSize", strconv.Itoa(opts.PageSize))
	}
	if opts.PageToken != "" {
		q.Set("pageToken", opts.PageToken)
	}
	body, err := c.doGET(ctx, c.dataPointsURL(opts.DataType, "reconcile"), q)
	if err != nil {
		return nil, err
	}
	var out dataPointsResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("decode reconcile response: %w", err)
	}
	return &out, nil
}

// reconcilePages follows nextPageToken so one tool call covers a date span.
// Sleep and exercise pages are capped at 25 by the API. The leftover token is
// set when maxPages is exhausted before the window is done.
func (c *Client) reconcilePages(ctx context.Context, opts reconcileOpts, maxPages int) (*dataPointsResponse, error) {
	if maxPages < 1 {
		maxPages = 1
	}
	combined := &dataPointsResponse{}
	for range maxPages {
		resp, err := c.reconcileDataPoints(ctx, opts)
		if err != nil {
			return nil, err
		}
		combined.DataPoints = append(combined.DataPoints, resp.DataPoints...)
		if len(resp.DataPoints) == 0 || resp.NextPageToken == "" {
			combined.NextPageToken = ""
			return combined, nil
		}
		opts.PageToken = resp.NextPageToken
		combined.NextPageToken = resp.NextPageToken
	}
	return combined, nil
}

func decodePoints(raw []json.RawMessage) []map[string]any {
	points := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		m, err := decodeDataPoint(item)
		if err != nil {
			continue
		}
		points = append(points, m)
	}
	return points
}

func (c *Client) getDataPoint(ctx context.Context, name string) (map[string]any, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("data point name is required")
	}
	if !strings.Contains(name, "/") {
		name = "users/me/dataTypes/exercise/dataPoints/" + name
	}
	body, err := c.doGET(ctx, c.BaseURL+"/v4/"+strings.TrimPrefix(name, "/"), nil)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	dec := json.NewDecoder(strings.NewReader(string(body)))
	dec.UseNumber()
	if err := dec.Decode(&m); err != nil {
		return nil, fmt.Errorf("decode data point: %w", err)
	}
	return m, nil
}

func decodeDataPoint(raw json.RawMessage) (map[string]any, error) {
	var m map[string]any
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	if err := dec.Decode(&m); err != nil {
		return nil, err
	}
	return m, nil
}

func dataPointName(m map[string]any) string {
	if v, ok := m["name"].(string); ok && v != "" {
		return v
	}
	if v, ok := m["dataPointName"].(string); ok {
		return v
	}
	return ""
}

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}
