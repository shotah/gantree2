// http.go
package garmin

import (
	"bytes"
	"context"
	"errors"
	"io"
	"math/rand"
	"net"
	"net/http"
	"strings"
	"time"
)

// RetryConfig controls HTTP retry/backoff for transient failures.
// Nil Options.Retry uses DefaultRetryConfig (tuned for snappy CLI/MCP).
type RetryConfig struct {
	MaxRetries     int
	InitialBackoff time.Duration
	MaxBackoff     time.Duration
}

func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxRetries:     2,
		InitialBackoff: 200 * time.Millisecond,
		MaxBackoff:     2 * time.Second,
	}
}

type httpTransport struct {
	client      *http.Client
	retry       RetryConfig
	rateLimiter *rateLimiter
}

func newHTTPTransport(client *http.Client, retry RetryConfig, rl *rateLimiter) *httpTransport {
	if client == nil {
		// Keep per-request timeout modest so MCP/CLI don't sit on dead sockets.
		client = &http.Client{Timeout: 15 * time.Second}
	}
	return &httpTransport{
		client:      client,
		retry:       retry,
		rateLimiter: rl,
	}
}

func (t *httpTransport) do(req *http.Request) (*http.Response, error) {
	// Read and buffer request body for potential retries
	var bodyBytes []byte
	if req.Body != nil && req.Body != http.NoBody {
		var err error
		bodyBytes, err = io.ReadAll(req.Body)
		req.Body.Close()
		if err != nil {
			return nil, err
		}
	}

	var lastErr error

	for attempt := 0; attempt <= t.retry.MaxRetries; attempt++ {
		if t.rateLimiter != nil {
			if err := t.rateLimiter.Wait(req.Context()); err != nil {
				return nil, err
			}
		}

		// Reset body for each attempt
		if bodyBytes != nil {
			req.Body = io.NopCloser(bytes.NewReader(bodyBytes))
			req.ContentLength = int64(len(bodyBytes))
		}

		resp, err := t.client.Do(req)
		if err != nil {
			lastErr = err
			if !t.shouldRetryError(err, attempt) {
				return nil, err
			}
			t.backoff(req.Context(), attempt)
			continue
		}

		if !t.shouldRetryStatus(resp.StatusCode, attempt) {
			return resp, nil
		}

		// Drain and close body for retry
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		lastErr = &APIError{StatusCode: resp.StatusCode, Status: resp.Status}

		t.backoff(req.Context(), attempt)
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, ErrMaxRetriesExceeded
}

func (t *httpTransport) shouldRetryStatus(statusCode, attempt int) bool {
	if attempt >= t.retry.MaxRetries {
		return false
	}
	return statusCode == http.StatusTooManyRequests || statusCode >= http.StatusInternalServerError
}

func (t *httpTransport) shouldRetryError(err error, attempt int) bool {
	if attempt >= t.retry.MaxRetries {
		return false
	}
	return isTransientTransportError(err)
}

// isTransientTransportError reports whether err is worth a short retry.
// Permanent failures (context cancel, VCR miss, most non-timeout errors) fail fast
// so MCP/CLI stay snappy and tests don't sleep on cassette mismatches.
func isTransientTransportError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	// go-vcr replay miss — not a network blip
	msg := err.Error()
	if strings.Contains(msg, "requested interaction not found") {
		return false
	}

	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	return false
}

func (t *httpTransport) backoff(ctx context.Context, attempt int) {
	backoff := t.retry.InitialBackoff * (1 << attempt)
	backoff = min(backoff, t.retry.MaxBackoff)
	// Add jitter (0-25%)
	//nolint:gosec // weak random is acceptable for backoff jitter
	jitter := time.Duration(rand.Int63n(int64(backoff / 4)))
	backoff += jitter

	select {
	case <-time.After(backoff):
	case <-ctx.Done():
	}
}
