package ghealth

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

func TestSaveLoadTokenRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tokens.json")
	c := &Client{TokenPath: path, mu: &sync.Mutex{}}
	tok := &oauth2.Token{
		AccessToken:  "access",
		RefreshToken: "refresh",
		TokenType:    "Bearer",
		Expiry:       time.Now().Add(time.Hour).UTC().Truncate(time.Second),
	}
	if err := c.SaveToken(tok); err != nil {
		t.Fatal(err)
	}
	c2 := &Client{TokenPath: path, mu: &sync.Mutex{}}
	if err := c2.LoadToken(); err != nil {
		t.Fatal(err)
	}
	if c2.AccessToken != "access" {
		t.Fatalf("access %q", c2.AccessToken)
	}
	c2.tokenMu().Lock()
	rt := c2.token.RefreshToken
	c2.tokenMu().Unlock()
	if rt != "refresh" {
		t.Fatalf("refresh %q", rt)
	}
}

func TestLoadTokenMissing(t *testing.T) {
	c := &Client{TokenPath: filepath.Join(t.TempDir(), "missing.json"), mu: &sync.Mutex{}}
	if err := c.LoadToken(); err == nil {
		t.Fatal("expected error")
	}
}

func TestMaybeFromEnvLoadsToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tokens.json")
	c := &Client{TokenPath: path, mu: &sync.Mutex{}}
	if err := c.SaveToken(&oauth2.Token{AccessToken: "from-disk", RefreshToken: "r"}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GOOGLE_HEALTH_CLIENT_ID", "cid")
	t.Setenv("GOOGLE_HEALTH_CLIENT_SECRET", "sec")
	t.Setenv("GOOGLE_HEALTH_TOKEN_PATH", path)
	t.Setenv("GOOGLE_HEALTH_BASE_URL", "")
	got := MaybeFromEnv()
	if got.AccessToken != "from-disk" {
		t.Fatalf("got %q", got.AccessToken)
	}
}

func TestDefaultTokenPath(t *testing.T) {
	t.Setenv("DATA_DIR", "")
	p := DefaultTokenPath()
	if p == "" {
		t.Fatal("empty")
	}
}

func TestDefaultTokenPathPrefersDataDir(t *testing.T) {
	t.Setenv("DATA_DIR", "/data")
	t.Setenv("HOME", "/home/nonroot")
	t.Setenv("XDG_CONFIG_HOME", "/home/nonroot/.config")
	got := DefaultTokenPath()
	want := filepath.FromSlash("/data/.config/ghealth/tokens.json")
	if got != want {
		t.Fatalf("DefaultTokenPath = %q, want %q (DATA_DIR volume, not overlay HOME)", got, want)
	}
}

func TestEnsureAccessTokenManual(t *testing.T) {
	c := &Client{AccessToken: "manual", mu: &sync.Mutex{}}
	if err := c.ensureAccessToken(t.Context()); err != nil {
		t.Fatal(err)
	}
}

func TestSaveTokenPreservesRefresh(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tokens.json")
	c := &Client{TokenPath: path, mu: &sync.Mutex{}}
	if err := c.SaveToken(&oauth2.Token{AccessToken: "a1", RefreshToken: "keep"}); err != nil {
		t.Fatal(err)
	}
	if err := c.SaveToken(&oauth2.Token{AccessToken: "a2", Expiry: time.Now().Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "keep") {
		t.Fatalf("refresh lost: %s", data)
	}
}
