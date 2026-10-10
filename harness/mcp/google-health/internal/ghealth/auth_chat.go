package ghealth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/oauth2"
)

const (
	pendingFileName        = "oauth_pending.json"
	pendingTTL             = 10 * time.Minute
	defaultChatRedirectURI = "https://shotah.github.io/ai-gantry/oauth-catch/"
)

// pendingAuth is persisted alongside the token path dir so a separate
// process (e.g. the gantry agent) can complete the exchange later.
type pendingAuth struct {
	Verifier    string    `json:"verifier"`
	State       string    `json:"state"`
	RedirectURI string    `json:"redirect_uri"`
	ExpiresAt   time.Time `json:"expires_at"`
}

func chatRedirectURI() string {
	if v := strings.TrimSpace(os.Getenv("GOOGLE_HEALTH_OAUTH_REDIRECT_URI")); v != "" {
		return v
	}
	return defaultChatRedirectURI
}

func pendingPath(tokenPath string) string {
	dir := filepath.Dir(tokenPath)
	return filepath.Join(dir, pendingFileName)
}

// RunAuthURL generates an OAuth URL for chat-driven auth (no localhost listener).
// It persists verifier + state to disk so that RunAuthExchange can complete later.
func RunAuthURL(ctx context.Context, c *Client) error {
	_ = ctx
	if c == nil {
		return errors.New("google health client not configured")
	}
	if c.ClientID == "" || c.ClientSecret == "" {
		return errors.New("set GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET before auth")
	}
	if c.TokenPath == "" {
		c.TokenPath = DefaultTokenPath()
	}

	stateBytes := make([]byte, 16)
	if _, err := rand.Read(stateBytes); err != nil {
		return fmt.Errorf("generate OAuth state: %w", err)
	}
	state := hex.EncodeToString(stateBytes)
	verifier := oauth2.GenerateVerifier()
	redirectURI := chatRedirectURI()

	cfg := c.oauthConfig()
	cfg.RedirectURL = redirectURI

	authURL := cfg.AuthCodeURL(state,
		oauth2.AccessTypeOffline,
		oauth2.S256ChallengeOption(verifier),
		oauth2.SetAuthURLParam("prompt", "consent"),
	)

	pending := pendingAuth{
		Verifier:    verifier,
		State:       state,
		RedirectURI: redirectURI,
		ExpiresAt:   time.Now().Add(pendingTTL),
	}
	pPath := pendingPath(c.ResolveTokenPath())
	if err := os.MkdirAll(filepath.Dir(pPath), 0o700); err != nil {
		return fmt.Errorf("create pending dir: %w", err)
	}
	data, err := json.MarshalIndent(pending, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal pending: %w", err)
	}
	if err := os.WriteFile(pPath, data, 0o600); err != nil {
		return fmt.Errorf("write pending: %w", err)
	}

	fmt.Printf("open %s\nthen paste the code: /auth ghealth <code>\nguide: https://github.com/shotah/ai-gantry/blob/main/docs/auth.md\n", authURL)
	return nil
}

// RunAuthExchange completes the chat-driven OAuth flow by exchanging the
// authorization code using the persisted verifier.
func RunAuthExchange(ctx context.Context, c *Client, code string) error {
	if c == nil {
		return errors.New("google health client not configured")
	}
	if c.ClientID == "" || c.ClientSecret == "" {
		return errors.New("set GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET before auth")
	}
	if c.TokenPath == "" {
		c.TokenPath = DefaultTokenPath()
	}
	code = strings.TrimSpace(code)
	if code == "" {
		return errors.New("authorization code is required")
	}

	pPath := pendingPath(c.ResolveTokenPath())
	data, err := os.ReadFile(pPath)
	if err != nil {
		return fmt.Errorf("no pending auth session (run 'auth url' first): %w", err)
	}
	var pending pendingAuth
	if err := json.Unmarshal(data, &pending); err != nil {
		return fmt.Errorf("parse pending auth: %w", err)
	}
	if time.Now().After(pending.ExpiresAt) {
		_ = os.Remove(pPath)
		return errors.New("pending auth session expired — run 'auth url' again")
	}

	cfg := c.oauthConfig()
	cfg.RedirectURL = pending.RedirectURI

	if ctx == nil {
		ctx = context.Background()
	}
	tok, err := cfg.Exchange(ctx, code, oauth2.VerifierOption(pending.Verifier))
	if err != nil {
		return fmt.Errorf("OAuth token exchange: %w", err)
	}
	if err := c.SaveToken(tok); err != nil {
		return err
	}
	_ = os.Remove(pPath)

	fmt.Printf("ghealth: authorized ✓ (tokens → %s)\n", c.ResolveTokenPath())
	return nil
}
