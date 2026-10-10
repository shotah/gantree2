package tools

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestValidateURL(t *testing.T) {
	t.Parallel()
	cases := []struct {
		raw     string
		wantErr bool
	}{
		{"https://example.com/rss.xml", false},
		{"http://localhost/feed", false},
		{"ftp://example.com/feed", true},
		{"https://", true},
		{"://bad", true},
		{"not a url", true},
	}
	for _, tc := range cases {
		err := validateURL(tc.raw)
		if tc.wantErr && err == nil {
			t.Errorf("validateURL(%q) = nil, want error", tc.raw)
		}
		if !tc.wantErr && err != nil {
			t.Errorf("validateURL(%q) = %v, want nil", tc.raw, err)
		}
	}
}

func TestHTTPFetcherGetOK(t *testing.T) {
	t.Parallel()
	var gotUA, gotAccept string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUA = r.Header.Get("User-Agent")
		gotAccept = r.Header.Get("Accept")
		w.Header().Set("Content-Type", "application/rss+xml; charset=utf-8")
		_, _ = io.WriteString(w, "<rss/>")
	}))
	t.Cleanup(srv.Close)

	f := &HTTPFetcher{Client: srv.Client(), UserAgent: "feeds-mcp-test/1", MaxBytes: 1024}
	body, ct, final, err := f.Get(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if string(body) != "<rss/>" {
		t.Fatalf("body = %q", body)
	}
	if ct != "application/rss+xml" {
		t.Fatalf("content-type = %q, want application/rss+xml", ct)
	}
	if final != srv.URL {
		t.Fatalf("final = %q, want %q", final, srv.URL)
	}
	if gotUA != "feeds-mcp-test/1" {
		t.Fatalf("User-Agent = %q", gotUA)
	}
	if !strings.Contains(gotAccept, "application/rss+xml") {
		t.Fatalf("Accept = %q", gotAccept)
	}
}

func TestHTTPFetcherDefaults(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") == "" {
			t.Error("empty User-Agent")
		}
		_, _ = io.WriteString(w, "ok")
	}))
	t.Cleanup(srv.Close)

	f := &HTTPFetcher{}
	body, _, _, err := f.Get(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if string(body) != "ok" {
		t.Fatalf("body = %q", body)
	}
}

func TestHTTPFetcherHTTPError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "nope", http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)

	f := &HTTPFetcher{Client: srv.Client()}
	_, _, _, err := f.Get(context.Background(), srv.URL)
	if err == nil || !strings.Contains(err.Error(), "HTTP 404") {
		t.Fatalf("err = %v, want HTTP 404", err)
	}
}

func TestHTTPFetcherTooLarge(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, strings.Repeat("x", 64))
	}))
	t.Cleanup(srv.Close)

	f := &HTTPFetcher{Client: srv.Client(), MaxBytes: 8}
	_, _, _, err := f.Get(context.Background(), srv.URL)
	if err == nil || !strings.Contains(err.Error(), "larger than") {
		t.Fatalf("err = %v, want size cap", err)
	}
}

func TestHTTPFetcherRejectsBadURL(t *testing.T) {
	t.Parallel()
	f := &HTTPFetcher{}
	_, _, _, err := f.Get(context.Background(), "ftp://example.com/x")
	if err == nil {
		t.Fatal("expected url scheme error")
	}
}

func TestHTTPFetcherRedirectLimit(t *testing.T) {
	t.Parallel()
	var srv *httptest.Server
	n := 0
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n++
		http.Redirect(w, r, srv.URL+"/hop", http.StatusFound)
	}))
	t.Cleanup(srv.Close)

	f := &HTTPFetcher{Client: newHTTPClient()}
	_, _, _, err := f.Get(context.Background(), srv.URL)
	if err == nil {
		t.Fatal("expected redirect stop")
	}
	if n < 2 {
		t.Fatalf("redirects = %d, want several attempts", n)
	}
}

func TestDefaultUserAgentEnv(t *testing.T) {
	t.Setenv("FEEDS_USER_AGENT", "nws-contact/1 (me@example.com)")
	if got := defaultUserAgent(); got != "nws-contact/1 (me@example.com)" {
		t.Fatalf("UA = %q", got)
	}
}

func TestDefaultUserAgentFallback(t *testing.T) {
	t.Setenv("FEEDS_USER_AGENT", "  ")
	got := defaultUserAgent()
	if !strings.Contains(got, "feeds-mcp") {
		t.Fatalf("UA = %q", got)
	}
}

func TestDefaultFetcher(t *testing.T) {
	t.Parallel()
	f := defaultFetcher()
	if f == nil || f.Client == nil || f.MaxBytes != defaultMaxBytes {
		t.Fatalf("defaultFetcher = %+v", f)
	}
}

func TestHTTPFetcherRedirectToBadScheme(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "ftp://example.com/x", http.StatusFound)
	}))
	t.Cleanup(srv.Close)

	f := &HTTPFetcher{Client: newHTTPClient()}
	_, _, _, err := f.Get(context.Background(), srv.URL)
	if err == nil {
		t.Fatal("expected redirect scheme error")
	}
}

func TestHTTPFetcherCanceledContext(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "ok")
	}))
	t.Cleanup(srv.Close)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	f := &HTTPFetcher{Client: srv.Client()}
	_, _, _, err := f.Get(ctx, srv.URL)
	if err == nil {
		t.Fatal("expected canceled context error")
	}
}
