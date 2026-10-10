package main

import (
	"path/filepath"
	"testing"
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
