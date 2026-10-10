package main

import (
	"context"
	"errors"
	"testing"

	mcpserver "github.com/shotah/mcp-go-math/internal/mcp"
)

func TestRunVersion(t *testing.T) {
	t.Parallel()
	code := run([]string{"--version"})
	if code != 0 {
		t.Fatalf("exit %d", code)
	}
}

func TestRunVersionStamped(t *testing.T) {
	prev := version
	version = "v9.9.9"
	t.Cleanup(func() { version = prev })

	code := run([]string{"--version"})
	if code != 0 {
		t.Fatalf("exit %d", code)
	}
}

func TestRunSelfTest(t *testing.T) {
	code := run([]string{"--self-test"})
	if code != 0 {
		t.Fatalf("exit %d", code)
	}
}

func TestRunBadFlag(t *testing.T) {
	t.Parallel()
	code := run([]string{"--nope"})
	if code != 2 {
		t.Fatalf("exit %d want 2", code)
	}
}

func TestRunServerOK(t *testing.T) {
	prev := runServer
	runServer = func(context.Context, *mcpserver.Server) error { return nil }
	t.Cleanup(func() { runServer = prev })

	code := run(nil)
	if code != 0 {
		t.Fatalf("exit %d", code)
	}
}

func TestRunServerError(t *testing.T) {
	prev := runServer
	runServer = func(context.Context, *mcpserver.Server) error {
		return errors.New("boom")
	}
	t.Cleanup(func() { runServer = prev })

	code := run(nil)
	if code != 1 {
		t.Fatalf("exit %d want 1", code)
	}
}
