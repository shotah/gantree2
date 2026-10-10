package ghealth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

func TestRunAuthURLSuccess(t *testing.T) {
	oldEP := oauthEndpoints
	oauthEndpoints = oauth2.Endpoint{
		AuthURL:  "https://accounts.google.com/o/oauth2/auth",
		TokenURL: "https://oauth2.googleapis.com/token",
	}
	t.Cleanup(func() { oauthEndpoints = oldEP })

	dir := t.TempDir()
	tokenPath := filepath.Join(dir, "tokens.json")
	c := &Client{
		ClientID:     "cid",
		ClientSecret: "sec",
		TokenPath:    tokenPath,
		mu:           &sync.Mutex{},
	}

	// Capture stdout
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = w
	if err := RunAuthURL(context.Background(), c); err != nil {
		os.Stdout = old
		t.Fatal(err)
	}
	_ = w.Close()
	os.Stdout = old
	buf := make([]byte, 4096)
	n, _ := r.Read(buf)
	output := string(buf[:n])

	if output == "" {
		t.Fatal("expected stdout output")
	}
	if !contains(output, "open ") {
		t.Fatalf("expected 'open ' in output, got: %s", output)
	}
	if !contains(output, "/auth ghealth <code>") {
		t.Fatalf("expected paste hint in output, got: %s", output)
	}
	if !contains(output, "guide:") {
		t.Fatalf("expected guide link in output, got: %s", output)
	}

	// Verify pending file was created
	pPath := pendingPath(tokenPath)
	data, err := os.ReadFile(pPath)
	if err != nil {
		t.Fatalf("pending file not created: %v", err)
	}
	var pending pendingAuth
	if err := json.Unmarshal(data, &pending); err != nil {
		t.Fatal(err)
	}
	if pending.Verifier == "" || pending.State == "" {
		t.Fatal("pending missing verifier or state")
	}
	if pending.RedirectURI != defaultChatRedirectURI {
		t.Fatalf("redirect=%q", pending.RedirectURI)
	}
	if pending.ExpiresAt.Before(time.Now()) {
		t.Fatal("pending already expired")
	}
}

func TestRunAuthURLCustomRedirect(t *testing.T) {
	t.Setenv("GOOGLE_HEALTH_OAUTH_REDIRECT_URI", "https://custom.example.com/callback")

	oldEP := oauthEndpoints
	oauthEndpoints = oauth2.Endpoint{
		AuthURL:  "https://accounts.google.com/o/oauth2/auth",
		TokenURL: "https://oauth2.googleapis.com/token",
	}
	t.Cleanup(func() { oauthEndpoints = oldEP })

	dir := t.TempDir()
	tokenPath := filepath.Join(dir, "tokens.json")
	c := &Client{
		ClientID:     "cid",
		ClientSecret: "sec",
		TokenPath:    tokenPath,
		mu:           &sync.Mutex{},
	}

	old := os.Stdout
	_, w, _ := os.Pipe()
	os.Stdout = w
	if err := RunAuthURL(context.Background(), c); err != nil {
		os.Stdout = old
		t.Fatal(err)
	}
	_ = w.Close()
	os.Stdout = old

	pPath := pendingPath(tokenPath)
	data, _ := os.ReadFile(pPath)
	var pending pendingAuth
	_ = json.Unmarshal(data, &pending)
	if pending.RedirectURI != "https://custom.example.com/callback" {
		t.Fatalf("redirect=%q", pending.RedirectURI)
	}
}

func TestRunAuthURLMissingCreds(t *testing.T) {
	if err := RunAuthURL(context.Background(), &Client{mu: &sync.Mutex{}}); err == nil {
		t.Fatal("expected error for missing credentials")
	}
}

func TestRunAuthURLNilClient(t *testing.T) {
	if err := RunAuthURL(context.Background(), nil); err == nil {
		t.Fatal("expected error for nil client")
	}
}

func TestRunAuthExchangeSuccess(t *testing.T) {
	oauthSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"acc","refresh_token":"ref","token_type":"Bearer","expires_in":3600}`))
	}))
	t.Cleanup(oauthSrv.Close)

	oldEP := oauthEndpoints
	oauthEndpoints = oauth2.Endpoint{
		AuthURL:  oauthSrv.URL + "/auth",
		TokenURL: oauthSrv.URL + "/token",
	}
	t.Cleanup(func() { oauthEndpoints = oldEP })

	dir := t.TempDir()
	tokenPath := filepath.Join(dir, "tokens.json")
	c := &Client{
		ClientID:     "cid",
		ClientSecret: "sec",
		TokenPath:    tokenPath,
		mu:           &sync.Mutex{},
	}

	// Write a pending file
	pending := pendingAuth{
		Verifier:    "test-verifier",
		State:       "test-state",
		RedirectURI: "https://shotah.github.io/ai-gantry/oauth-catch/",
		ExpiresAt:   time.Now().Add(5 * time.Minute),
	}
	pPath := pendingPath(tokenPath)
	data, _ := json.MarshalIndent(pending, "", "  ")
	if err := os.WriteFile(pPath, data, 0o600); err != nil {
		t.Fatal(err)
	}

	// Capture stdout
	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w
	err := RunAuthExchange(context.Background(), c, "test-code")
	_ = w.Close()
	os.Stdout = old
	buf := make([]byte, 4096)
	n, _ := r.Read(buf)
	output := string(buf[:n])

	if err != nil {
		t.Fatal(err)
	}
	if !contains(output, "ghealth: authorized ✓") {
		t.Fatalf("expected success message, got: %s", output)
	}

	// Verify token was saved
	if _, err := os.Stat(tokenPath); err != nil {
		t.Fatalf("token not saved: %v", err)
	}
	// Verify pending was deleted
	if _, err := os.Stat(pPath); err == nil {
		t.Fatal("pending file should have been deleted")
	}
}

func TestRunAuthExchangeExpired(t *testing.T) {
	dir := t.TempDir()
	tokenPath := filepath.Join(dir, "tokens.json")
	c := &Client{
		ClientID:     "cid",
		ClientSecret: "sec",
		TokenPath:    tokenPath,
		mu:           &sync.Mutex{},
	}

	pending := pendingAuth{
		Verifier:    "v",
		State:       "s",
		RedirectURI: "http://localhost",
		ExpiresAt:   time.Now().Add(-time.Minute),
	}
	pPath := pendingPath(tokenPath)
	data, _ := json.MarshalIndent(pending, "", "  ")
	_ = os.WriteFile(pPath, data, 0o600)

	err := RunAuthExchange(context.Background(), c, "code")
	if err == nil || !contains(err.Error(), "expired") {
		t.Fatalf("expected expired error, got: %v", err)
	}
}

func TestRunAuthExchangeNoPending(t *testing.T) {
	dir := t.TempDir()
	tokenPath := filepath.Join(dir, "tokens.json")
	c := &Client{
		ClientID:     "cid",
		ClientSecret: "sec",
		TokenPath:    tokenPath,
		mu:           &sync.Mutex{},
	}

	err := RunAuthExchange(context.Background(), c, "code")
	if err == nil || !contains(err.Error(), "no pending") {
		t.Fatalf("expected no-pending error, got: %v", err)
	}
}

func TestRunAuthExchangeEmptyCode(t *testing.T) {
	c := &Client{
		ClientID:     "cid",
		ClientSecret: "sec",
		TokenPath:    filepath.Join(t.TempDir(), "t.json"),
		mu:           &sync.Mutex{},
	}
	err := RunAuthExchange(context.Background(), c, "")
	if err == nil || !contains(err.Error(), "code is required") {
		t.Fatalf("expected code-required error, got: %v", err)
	}
}

func TestRunAuthExchangeNilClient(t *testing.T) {
	if err := RunAuthExchange(context.Background(), nil, "code"); err == nil {
		t.Fatal("expected error")
	}
}

func TestRunAuthExchangeMissingCreds(t *testing.T) {
	if err := RunAuthExchange(context.Background(), &Client{mu: &sync.Mutex{}}, "code"); err == nil {
		t.Fatal("expected error")
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || s != "" && containsStr(s, substr))
}

func containsStr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
