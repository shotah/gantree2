package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultBaseURL  = "https://api.x.com"
	defaultTimeout  = 15 * time.Second
	defaultMaxBytes = 2 << 20 // 2 MiB
	apiMinResults   = 5
	apiMaxResults   = 100
)

// Client talks to X API v2 with an app-only Bearer token.
type Client struct {
	HTTP     *http.Client
	BaseURL  string
	Token    string
	MaxBytes int64
}

// User is a lookup result from GET /2/users/by/username/:username.
type User struct {
	ID       string
	Username string
}

// Tweet is one status from GET /2/users/:id/tweets.
type Tweet struct {
	ID   string
	Text string
}

type userLookupResponse struct {
	Data *struct {
		ID       string `json:"id"`
		Username string `json:"username"`
	} `json:"data"`
}

type tweetsResponse struct {
	Data []struct {
		ID   string `json:"id"`
		Text string `json:"text"`
	} `json:"data"`
}

type xErrorBody struct {
	Title  string `json:"title"`
	Detail string `json:"detail"`
	Status int    `json:"status"`
	Errors []struct {
		Message string `json:"message"`
		Detail  string `json:"detail"`
		Title   string `json:"title"`
	} `json:"errors"`
}

// APIError is a non-2xx X API response.
type APIError struct {
	Status int
	Title  string
	Detail string
}

func (e *APIError) Error() string {
	msg := strings.TrimSpace(e.Detail)
	if msg == "" {
		msg = strings.TrimSpace(e.Title)
	}
	if msg == "" {
		msg = fmt.Sprintf("HTTP %d", e.Status)
	}
	return "X API: " + msg
}

func clientFromEnv() (*Client, error) {
	token := strings.TrimSpace(os.Getenv("X_BEARER_TOKEN"))
	if token == "" {
		return nil, errMissingToken
	}
	return NewClient(token), nil
}

// NewClient returns an X API client using token.
func NewClient(token string) *Client {
	return &Client{
		HTTP:     &http.Client{Timeout: defaultTimeout},
		BaseURL:  defaultBaseURL,
		Token:    token,
		MaxBytes: defaultMaxBytes,
	}
}

// LookupUser resolves a public handle to a user id.
func (c *Client) LookupUser(ctx context.Context, username string) (User, error) {
	path := "/2/users/by/username/" + url.PathEscape(username)
	body, status, err := c.get(ctx, path, nil)
	if err != nil {
		return User{}, err
	}
	if status != http.StatusOK {
		return User{}, parseAPIError(status, body)
	}
	var resp userLookupResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return User{}, fmt.Errorf("user lookup: %w", err)
	}
	if resp.Data == nil || strings.TrimSpace(resp.Data.ID) == "" {
		return User{}, &APIError{Status: http.StatusNotFound, Title: "Not Found", Detail: "user not found"}
	}
	return User{
		ID:       strings.TrimSpace(resp.Data.ID),
		Username: firstNonEmpty(strings.TrimSpace(resp.Data.Username), username),
	}, nil
}

// ListTweets returns recent public posts for userID (newest first).
func (c *Client) ListTweets(ctx context.Context, userID string, limit int) ([]Tweet, error) {
	maxResults := min(max(limit, apiMinResults), apiMaxResults)
	q := url.Values{}
	q.Set("max_results", strconv.Itoa(maxResults))
	path := "/2/users/" + url.PathEscape(userID) + "/tweets"
	body, status, err := c.get(ctx, path, q)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, parseAPIError(status, body)
	}
	var resp tweetsResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("tweet list: %w", err)
	}
	out := make([]Tweet, 0, len(resp.Data))
	for _, t := range resp.Data {
		id := strings.TrimSpace(t.ID)
		if id == "" {
			continue
		}
		out = append(out, Tweet{ID: id, Text: t.Text})
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (c *Client) get(ctx context.Context, path string, query url.Values) ([]byte, int, error) {
	base := c.BaseURL
	if base == "" {
		base = defaultBaseURL
	}
	u, err := url.Parse(base)
	if err != nil {
		return nil, 0, fmt.Errorf("base url: %w", err)
	}
	u.Path = strings.TrimSuffix(u.Path, "/") + path
	if query != nil {
		u.RawQuery = query.Encode()
	}

	client := c.HTTP
	if client == nil {
		client = &http.Client{Timeout: defaultTimeout}
	}
	maxBytes := c.MaxBytes
	if maxBytes < 1 {
		maxBytes = defaultMaxBytes
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), http.NoBody)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "twitter-mcp/0.1 (+https://github.com/shotah/twitter-mcp)")

	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = resp.Body.Close() }()

	limited := io.LimitReader(resp.Body, maxBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	if int64(len(body)) > maxBytes {
		return nil, resp.StatusCode, fmt.Errorf("response larger than %d bytes", maxBytes)
	}
	return body, resp.StatusCode, nil
}

func parseAPIError(status int, body []byte) error {
	var parsed xErrorBody
	_ = json.Unmarshal(body, &parsed)
	detail := strings.TrimSpace(parsed.Detail)
	title := strings.TrimSpace(parsed.Title)
	for _, e := range parsed.Errors {
		if detail == "" {
			detail = firstNonEmpty(e.Detail, e.Message)
		}
		if title == "" {
			title = e.Title
		}
	}
	return &APIError{Status: status, Title: title, Detail: detail}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
