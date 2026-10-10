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
	if ServerName != "twitter" {
		t.Fatalf("ServerName = %q, want twitter", ServerName)
	}
	if ServerVersion == "" {
		t.Fatal("ServerVersion is empty")
	}
}
