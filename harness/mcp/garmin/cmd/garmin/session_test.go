package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shotah/go-garmin/garmin"
)

func TestSessionPathPrefersDataDirOverHome(t *testing.T) {
	t.Setenv("GARMIN_SESSION_PATH", "")
	t.Setenv("DATA_DIR", "/data")
	t.Setenv("HOME", "/home/nonroot")
	t.Setenv("XDG_CONFIG_HOME", "/home/nonroot/.config")
	got := sessionPath()
	want := filepath.FromSlash("/data/.config/garmin/session.json")
	if got != want {
		t.Errorf("sessionPath = %q, want %q (DATA_DIR volume, not overlay HOME)", got, want)
	}
}

func TestSessionPathExplicitOverride(t *testing.T) {
	t.Setenv("GARMIN_SESSION_PATH", "/custom/garmin/session.json")
	t.Setenv("DATA_DIR", "/data")
	got := sessionPath()
	if got != "/custom/garmin/session.json" {
		t.Errorf("sessionPath = %q, want explicit GARMIN_SESSION_PATH", got)
	}
}

func TestSessionPathHomeWhenNoDataDir(t *testing.T) {
	t.Setenv("GARMIN_SESSION_PATH", "")
	t.Setenv("DATA_DIR", "")
	t.Setenv("XDG_CONFIG_HOME", "/tmp/xdg")
	got := sessionPath()
	want := filepath.FromSlash("/tmp/xdg/garmin/session.json")
	if got != want {
		t.Errorf("sessionPath = %q, want %q", got, want)
	}
}

func TestLoadSaveAndRemoveSession(t *testing.T) {
	path := filepath.Join(t.TempDir(), "garmin", "session.json")
	t.Setenv("GARMIN_SESSION_PATH", path)

	if _, err := loadClient(); err == nil || err.Error() != "not logged in, run: garmin login" {
		t.Fatalf("missing err=%v", err)
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadClient(); err == nil || err.Error() == "not logged in, run: garmin login" {
		t.Fatalf("corrupt err=%v", err)
	}

	raw := []byte(`{"oauth2_access_token":"a","oauth2_refresh_token":"r","oauth2_expiry":"2030-01-01T00:00:00Z","domain":"garmin.com"}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	client, err := loadClient()
	if err != nil {
		t.Fatal(err)
	}
	if err := saveClient(client); err != nil {
		t.Fatal(err)
	}
	saved, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(saved), "oauth2_access_token") {
		t.Fatalf("saved %s err=%v", saved, err)
	}
	if err := removeSession(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("stat %v", err)
	}

	// saveClient creates a missing parent directory.
	nested := filepath.Join(t.TempDir(), "nested", "session.json")
	t.Setenv("GARMIN_SESSION_PATH", nested)
	if err := saveClient(garmin.New(garmin.Options{})); err != nil {
		t.Fatal(err)
	}
}
