// http_test.go
package garmin

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestDefaultRetryConfig(t *testing.T) {
	cfg := DefaultRetryConfig()
	if cfg.MaxRetries != 2 {
		t.Errorf("expected MaxRetries 2, got %d", cfg.MaxRetries)
	}
	if cfg.InitialBackoff != 200*time.Millisecond {
		t.Errorf("expected InitialBackoff 200ms, got %v", cfg.InitialBackoff)
	}
	if cfg.MaxBackoff != 2*time.Second {
		t.Errorf("expected MaxBackoff 2s, got %v", cfg.MaxBackoff)
	}
}

func TestHTTPClientRetry(t *testing.T) {
	attempts := atomic.Int32{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		n := attempts.Add(1)
		if n < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	transport := newHTTPTransport(&http.Client{}, RetryConfig{
		MaxRetries:     3,
		InitialBackoff: 10 * time.Millisecond,
		MaxBackoff:     100 * time.Millisecond,
	}, nil)

	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, server.URL, http.NoBody)
	resp, err := transport.do(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer resp.Body.Close()

	if attempts.Load() != 3 {
		t.Errorf("expected 3 attempts, got %d", attempts.Load())
	}
}

func TestIsTransientTransportError(t *testing.T) {
	t.Parallel()

	if isTransientTransportError(errors.New("requested interaction not found")) {
		t.Fatal("VCR miss must not be retried")
	}
	if isTransientTransportError(context.Canceled) {
		t.Fatal("canceled context must not be retried")
	}
	if isTransientTransportError(context.DeadlineExceeded) {
		t.Fatal("deadline exceeded must not be retried")
	}
	if isTransientTransportError(errors.New("connection refused")) {
		t.Fatal("non-timeout transport errors must not be retried by default")
	}
}

func TestHTTPClientNoRetryOnVCRMiss(t *testing.T) {
	attempts := atomic.Int32{}
	vcrMiss := errors.New(`Get "https://example.com/x": requested interaction not found`)

	transport := newHTTPTransport(&http.Client{
		Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			attempts.Add(1)
			return nil, vcrMiss
		}),
	}, RetryConfig{
		MaxRetries:     3,
		InitialBackoff: time.Second, // would hang tests if retried
		MaxBackoff:     time.Second,
	}, nil)

	start := time.Now()
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "https://example.com/x", http.NoBody)
	resp, err := transport.do(req)
	elapsed := time.Since(start)
	if resp != nil {
		resp.Body.Close()
	}

	if !errors.Is(err, vcrMiss) && (err == nil || err.Error() != vcrMiss.Error()) {
		t.Fatalf("expected vcr miss error, got %v", err)
	}
	if attempts.Load() != 1 {
		t.Fatalf("expected 1 attempt, got %d", attempts.Load())
	}
	if elapsed > 200*time.Millisecond {
		t.Fatalf("expected fail-fast, took %v", elapsed)
	}
}
