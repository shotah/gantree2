package tools

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientFromEnvMissing(t *testing.T) {
	t.Setenv("X_BEARER_TOKEN", "  ")
	_, err := clientFromEnv()
	if err == nil || !errors.Is(err, errMissingToken) {
		t.Fatalf("err = %v", err)
	}
}

func TestClientFromEnv(t *testing.T) {
	t.Setenv("X_BEARER_TOKEN", "secret")
	c, err := clientFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if c.Token != "secret" {
		t.Fatalf("token = %q", c.Token)
	}
}

func TestLookupUserInvalidJSON(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`not-json`))
	}))
	t.Cleanup(srv.Close)
	_, err := testClient(srv).LookupUser(context.Background(), "foo")
	if err == nil || !strings.Contains(err.Error(), "user lookup") {
		t.Fatalf("err = %v", err)
	}
}

func TestLookupUserEmptyData(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)
	_, err := testClient(srv).LookupUser(context.Background(), "foo")
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Status != http.StatusNotFound {
		t.Fatalf("err = %v", err)
	}
}

func TestListTweetsInvalidJSON(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{`))
	}))
	t.Cleanup(srv.Close)
	_, err := testClient(srv).ListTweets(context.Background(), "1", 5)
	if err == nil || !strings.Contains(err.Error(), "tweet list") {
		t.Fatalf("err = %v", err)
	}
}

func TestClientGetTooLarge(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("abcdef"))
	}))
	t.Cleanup(srv.Close)
	c := testClient(srv)
	c.MaxBytes = 3
	_, err := c.LookupUser(context.Background(), "foo")
	if err == nil || !strings.Contains(err.Error(), "larger than") {
		t.Fatalf("err = %v", err)
	}
}

func TestClientGetUsesDefaults(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("auth = %q", r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`{"data":{"id":"1","username":"foo"}}`))
	}))
	t.Cleanup(srv.Close)
	c := &Client{BaseURL: srv.URL, Token: "tok", HTTP: srv.Client()}
	u, err := c.LookupUser(context.Background(), "foo")
	if err != nil {
		t.Fatal(err)
	}
	if u.ID != "1" {
		t.Fatalf("id = %q", u.ID)
	}
}

func TestParseAPIErrorMessageField(t *testing.T) {
	t.Parallel()
	err := parseAPIError(401, []byte(`{"errors":[{"message":"Invalid or expired token"}]}`))
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatal(err)
	}
	if apiErr.Detail != "Invalid or expired token" {
		t.Fatalf("detail = %q", apiErr.Detail)
	}
	if !strings.Contains(apiErr.Error(), "Invalid or expired token") {
		t.Fatalf("Error() = %q", apiErr.Error())
	}
}

func TestAPIErrorFallback(t *testing.T) {
	t.Parallel()
	err := &APIError{Status: 500}
	if err.Error() != "X API: HTTP 500" {
		t.Fatalf("Error() = %q", err.Error())
	}
	err = &APIError{Status: 400, Title: "Bad Request"}
	if !strings.Contains(err.Error(), "Bad Request") {
		t.Fatalf("Error() = %q", err.Error())
	}
}

func TestListTweetsHTTPError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"title":"Bad Request","detail":"max_results"}`))
	}))
	t.Cleanup(srv.Close)
	_, err := testClient(srv).ListTweets(context.Background(), "1", 5)
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Status != http.StatusBadRequest {
		t.Fatalf("err = %v", err)
	}
}

func TestClientBadBaseURL(t *testing.T) {
	t.Parallel()
	c := NewClient("tok")
	c.BaseURL = "://bad"
	_, err := c.LookupUser(context.Background(), "foo")
	if err == nil || !strings.Contains(err.Error(), "base url") {
		t.Fatalf("err = %v", err)
	}
}

func TestFirstNonEmpty(t *testing.T) {
	t.Parallel()
	if firstNonEmpty(" ", "", "ok") != "ok" {
		t.Fatal(firstNonEmpty(" ", "", "ok"))
	}
	if firstNonEmpty("", "  ") != "" {
		t.Fatal("expected empty")
	}
}

func TestClientNilHTTPAndClosedServer(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"data":{"id":"1","username":"foo"}}`))
	}))
	c := &Client{BaseURL: srv.URL, Token: "tok"}
	u, err := c.LookupUser(context.Background(), "foo")
	if err != nil {
		t.Fatal(err)
	}
	if u.ID != "1" {
		t.Fatalf("id = %q", u.ID)
	}
	srv.Close()
	if _, err := c.LookupUser(context.Background(), "foo"); err == nil {
		t.Fatal("expected error after close")
	}
}

func TestListTweetsNetworkError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	c := testClient(srv)
	srv.Close()
	if _, err := c.ListTweets(context.Background(), "1", 5); err == nil {
		t.Fatal("expected error")
	}
}

func TestClientGetDefaultBaseAndMaxBytes(t *testing.T) {
	t.Parallel()
	var gotURL string
	c := &Client{
		Token:    "tok",
		MaxBytes: 0,
		HTTP: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			gotURL = r.URL.String()
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader(`{"data":{"id":"1","username":"foo"}}`)),
				Header:     make(http.Header),
			}, nil
		})},
	}
	u, err := c.LookupUser(context.Background(), "foo")
	if err != nil {
		t.Fatal(err)
	}
	if u.ID != "1" {
		t.Fatalf("id = %q", u.ID)
	}
	if !strings.HasPrefix(gotURL, defaultBaseURL) {
		t.Fatalf("url = %q", gotURL)
	}
}

func TestNewClientDefaults(t *testing.T) {
	t.Parallel()
	c := NewClient("tok")
	if c.BaseURL != defaultBaseURL || c.Token != "tok" || c.HTTP == nil {
		t.Fatalf("%+v", c)
	}
}

func TestClientGetReadError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", "32")
		w.WriteHeader(http.StatusOK)
		hj, ok := w.(http.Flusher)
		if ok {
			hj.Flush()
		}
	}))
	t.Cleanup(srv.Close)
	// Close immediately so the body read fails for some clients; if it
	// succeeds, still exercise the path by using a broken transport.
	c := testClient(srv)
	c.HTTP = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(errReader{}),
			Header:     make(http.Header),
		}, nil
	})}
	_, err := c.LookupUser(context.Background(), "foo")
	if err == nil {
		t.Fatal("expected read error")
	}
}

type errReader struct{}

func (errReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
