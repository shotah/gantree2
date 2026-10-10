package tools

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	defaultTimeout  = 15 * time.Second
	defaultMaxBytes = 2 << 20 // 2 MiB
	htmlMaxBytes    = 512 << 10
	maxRedirects    = 5
)

// Fetcher GETs a URL. Tests inject httptest; production uses HTTPFetcher.
type Fetcher interface {
	Get(ctx context.Context, rawURL string) (body []byte, contentType, finalURL string, err error)
}

// HTTPFetcher is a size-capped http.Client.
type HTTPFetcher struct {
	Client    *http.Client
	UserAgent string
	MaxBytes  int64
}

func defaultUserAgent() string {
	if ua := strings.TrimSpace(os.Getenv("FEEDS_USER_AGENT")); ua != "" {
		return ua
	}
	return "feeds-mcp/0.1 (+https://github.com/shotah/feeds-mcp)"
}

func defaultFetcher() *HTTPFetcher {
	return &HTTPFetcher{
		Client:    newHTTPClient(),
		UserAgent: defaultUserAgent(),
		MaxBytes:  defaultMaxBytes,
	}
}

func newHTTPClient() *http.Client {
	return &http.Client{
		Timeout: defaultTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return fmt.Errorf("stopped after %d redirects", maxRedirects)
			}
			if err := validateURL(req.URL.String()); err != nil {
				return err
			}
			return nil
		},
	}
}

func validateURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("url: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return errors.New("url must be http or https")
	}
	if u.Host == "" {
		return errors.New("url host is required")
	}
	return nil
}

// Get downloads rawURL. The caller must pass a validated http(s) URL.
func (f *HTTPFetcher) Get(ctx context.Context, rawURL string) ([]byte, string, string, error) {
	if err := validateURL(rawURL); err != nil {
		return nil, "", "", err
	}
	client := f.Client
	if client == nil {
		client = newHTTPClient()
	}
	maxBytes := f.MaxBytes
	if maxBytes < 1 {
		maxBytes = defaultMaxBytes
	}
	ua := f.UserAgent
	if ua == "" {
		ua = defaultUserAgent()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, http.NoBody)
	if err != nil {
		return nil, "", "", err
	}
	req.Header.Set("User-Agent", ua)
	req.Header.Set("Accept", "application/atom+xml, application/rss+xml, application/feed+json, application/json, application/xml, text/xml, text/html;q=0.8, */*;q=0.5")

	resp, err := client.Do(req)
	if err != nil {
		return nil, "", "", err
	}
	defer func() { _ = resp.Body.Close() }()

	final := rawURL
	if resp.Request != nil && resp.Request.URL != nil {
		final = resp.Request.URL.String()
	}
	if resp.StatusCode != http.StatusOK {
		return nil, "", final, fmt.Errorf("GET %s: HTTP %d", final, resp.StatusCode)
	}

	limited := io.LimitReader(resp.Body, maxBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, "", final, err
	}
	if int64(len(body)) > maxBytes {
		return nil, "", final, fmt.Errorf("response larger than %d bytes", maxBytes)
	}
	ct := resp.Header.Get("Content-Type")
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	return body, strings.ToLower(ct), final, nil
}
