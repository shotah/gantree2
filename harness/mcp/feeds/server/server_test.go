package server

import "testing"

func TestNew(t *testing.T) {
	t.Parallel()
	s := New()
	if s == nil {
		t.Fatal("New() returned nil")
	}
}

func TestServerConstants(t *testing.T) {
	t.Parallel()
	if ServerName != "feeds" {
		t.Fatalf("ServerName = %q, want feeds", ServerName)
	}
	if ServerVersion == "" {
		t.Fatal("ServerVersion is empty")
	}
}
