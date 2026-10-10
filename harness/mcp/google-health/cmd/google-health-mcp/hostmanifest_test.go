package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"testing"

	mcpserver "github.com/shotah/google-health-mcp/internal/mcp"
)

func TestHostManifest(t *testing.T) {
	old := runServer
	runServer = func(context.Context, *mcpserver.Server) error {
		t.Error("host-manifest started the stdio server")
		return nil
	}
	t.Cleanup(func() { runServer = old })

	var buf bytes.Buffer
	if err := encodeHostManifest(&buf); err != nil {
		t.Fatalf("encodeHostManifest() error = %v", err)
	}
	assertGoogleHealthManifest(t, buf.Bytes())

	oldOut := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = w
	code := run([]string{"host-manifest"})
	_ = w.Close()
	os.Stdout = oldOut
	out, _ := io.ReadAll(r)
	if code != 0 {
		t.Fatalf("exit %d\n%s", code, out)
	}
	assertGoogleHealthManifest(t, out)
}

func assertGoogleHealthManifest(t *testing.T, raw []byte) {
	t.Helper()

	var got struct {
		Name     string   `json:"name"`
		Command  string   `json:"command"`
		EnvKeys  []string `json:"env_keys"`
		AuthArgs []string `json:"auth_args"`
		AuthFlow string   `json:"auth_flow"`
		HomeOnly bool     `json:"home_only"`
		Blurb    string   `json:"blurb"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("parse: %v\n%s", err, raw)
	}
	if got.Name != "google-health" {
		t.Errorf("name = %q", got.Name)
	}
	if got.Command != "google-health-mcp" {
		t.Errorf("command = %q", got.Command)
	}
	if len(got.EnvKeys) != 2 || got.EnvKeys[0] != "GOOGLE_HEALTH_CLIENT_ID" || got.EnvKeys[1] != "GOOGLE_HEALTH_CLIENT_SECRET" {
		t.Errorf("env_keys = %v", got.EnvKeys)
	}
	if len(got.AuthArgs) != 1 || got.AuthArgs[0] != "auth" {
		t.Errorf("auth_args = %v", got.AuthArgs)
	}
	if got.AuthFlow != "pkce" {
		t.Errorf("auth_flow = %q", got.AuthFlow)
	}
	if got.HomeOnly {
		t.Error("home_only = true")
	}
	if got.Blurb == "" {
		t.Error("blurb empty")
	}

	var doc map[string]json.RawMessage
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if _, ok := doc["home_only"]; ok {
		t.Error("home_only should be omitted")
	}
}
