package auth

import (
	"testing"

	"golang.org/x/oauth2/google"
)

func TestNewOAuthConfig(t *testing.T) {
	t.Parallel()
	cfg := NewOAuthConfig("cid", "csecret")
	if cfg.ClientID != "cid" || cfg.ClientSecret != "csecret" {
		t.Fatalf("unexpected credentials: %+v", cfg)
	}
	if cfg.Endpoint != google.Endpoint {
		t.Fatalf("unexpected endpoint: %+v", cfg.Endpoint)
	}
	if cfg.RedirectURL != "http://localhost:4100/code" {
		t.Fatalf("unexpected redirect: %q", cfg.RedirectURL)
	}
	if len(cfg.Scopes) != len(DefaultScopes) {
		t.Fatalf("scopes=%d want %d", len(cfg.Scopes), len(DefaultScopes))
	}
}
