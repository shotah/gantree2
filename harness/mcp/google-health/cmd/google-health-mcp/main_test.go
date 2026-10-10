package main

import (
	"bytes"
	"context"
	"io"
	"os"
	"testing"

	"github.com/shotah/google-health-mcp/internal/ghealth"
	mcpserver "github.com/shotah/google-health-mcp/internal/mcp"
)

func TestRunVersion(t *testing.T) {
	version = "v0.0.0-test"
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = w
	code := run([]string{"--version"})
	_ = w.Close()
	os.Stdout = old
	out, _ := io.ReadAll(r)
	if code != 0 {
		t.Fatalf("exit %d", code)
	}
	if !bytes.Contains(out, []byte("v0.0.0-test")) {
		t.Fatalf("got %q", out)
	}
}

func TestRunSelfTest(t *testing.T) {
	if code := run([]string{"--self-test"}); code != 0 {
		t.Fatalf("exit %d", code)
	}
}

func TestRunAuthSuccess(t *testing.T) {
	old := runAuth
	runAuth = func(context.Context, *ghealth.Client) error { return nil }
	t.Cleanup(func() { runAuth = old })
	if code := run([]string{"auth"}); code != 0 {
		t.Fatalf("want 0, got %d", code)
	}
}

func TestRunAuthError(t *testing.T) {
	old := runAuth
	runAuth = func(context.Context, *ghealth.Client) error { return context.Canceled }
	t.Cleanup(func() { runAuth = old })
	if code := run([]string{"auth"}); code != 1 {
		t.Fatalf("want 1, got %d", code)
	}
}

func TestRunAuthURLSuccess(t *testing.T) {
	old := runAuthURL
	runAuthURL = func(context.Context, *ghealth.Client) error { return nil }
	t.Cleanup(func() { runAuthURL = old })
	if code := run([]string{"auth", "url"}); code != 0 {
		t.Fatalf("want 0, got %d", code)
	}
}

func TestRunAuthURLError(t *testing.T) {
	old := runAuthURL
	runAuthURL = func(context.Context, *ghealth.Client) error { return context.Canceled }
	t.Cleanup(func() { runAuthURL = old })
	if code := run([]string{"auth", "url"}); code != 1 {
		t.Fatalf("want 1, got %d", code)
	}
}

func TestRunAuthExchangeSuccess(t *testing.T) {
	old := runAuthExchange
	runAuthExchange = func(context.Context, *ghealth.Client, string) error { return nil }
	t.Cleanup(func() { runAuthExchange = old })
	if code := run([]string{"auth", "exchange", "my-code"}); code != 0 {
		t.Fatalf("want 0, got %d", code)
	}
}

func TestRunAuthExchangeError(t *testing.T) {
	old := runAuthExchange
	runAuthExchange = func(context.Context, *ghealth.Client, string) error { return context.Canceled }
	t.Cleanup(func() { runAuthExchange = old })
	if code := run([]string{"auth", "exchange", "code"}); code != 1 {
		t.Fatalf("want 1, got %d", code)
	}
}

func TestRunAuthExchangeMissingCode(t *testing.T) {
	if code := run([]string{"auth", "exchange"}); code != 2 {
		t.Fatalf("want 2, got %d", code)
	}
}

func TestRunBadFlag(t *testing.T) {
	if code := run([]string{"--not-a-real-flag"}); code != 2 {
		t.Fatalf("want 2, got %d", code)
	}
}

func TestRunServerError(t *testing.T) {
	old := runServer
	runServer = func(context.Context, *mcpserver.Server) error {
		return context.Canceled
	}
	t.Cleanup(func() { runServer = old })
	if code := run(nil); code != 1 {
		t.Fatalf("want 1, got %d", code)
	}
}
