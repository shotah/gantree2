package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"testing"

	mcpserver "github.com/shotah/flights-search-mcp/internal/mcp"
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
	assertFlightsManifest(t, buf.Bytes())

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
	assertFlightsManifest(t, out)
}

func assertFlightsManifest(t *testing.T, raw []byte) {
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
	if got.Name != "flights" {
		t.Errorf("name = %q", got.Name)
	}
	if got.Command != "flights-search-mcp" {
		t.Errorf("command = %q", got.Command)
	}
	if len(got.EnvKeys) != 1 || got.EnvKeys[0] != "SERPAPI_API_KEY" {
		t.Errorf("env_keys = %v", got.EnvKeys)
	}
	if len(got.AuthArgs) != 0 || got.AuthFlow != "" {
		t.Errorf("auth = %v %q", got.AuthArgs, got.AuthFlow)
	}
	if got.HomeOnly {
		t.Error("home_only = true")
	}
	if got.Blurb != "Google Flights prices and checkout links. One SerpAPI key." {
		t.Errorf("blurb = %q", got.Blurb)
	}

	var doc map[string]json.RawMessage
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"home_only", "auth_args", "auth_flow", "args"} {
		if _, ok := doc[key]; ok {
			t.Errorf("%s should be omitted", key)
		}
	}
}
