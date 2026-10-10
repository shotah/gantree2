package ghealth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2"
)

// storedToken is the on-disk OAuth token shape (access + refresh + expiry).
type storedToken struct {
	AccessToken  string    `json:"access_token"`
	TokenType    string    `json:"token_type,omitempty"`
	RefreshToken string    `json:"refresh_token,omitempty"`
	Expiry       time.Time `json:"expiry,omitzero"`
}

func (c *Client) tokenMu() *sync.Mutex {
	if c.mu == nil {
		c.mu = &sync.Mutex{}
	}
	return c.mu
}

// DefaultTokenPath returns the default tokens.json.
// $DATA_DIR/.config/ghealth wins on gantry (Distroless HOME is overlay).
func DefaultTokenPath() string {
	if data := strings.TrimSpace(os.Getenv("DATA_DIR")); data != "" {
		return filepath.Join(data, ".config", "ghealth", "tokens.json")
	}
	dir, err := os.UserConfigDir()
	if err != nil || dir == "" {
		return "tokens.json"
	}
	return filepath.Join(dir, "google-health-mcp", "tokens.json")
}

// ResolveTokenPath returns TokenPath, or DefaultTokenPath when unset.
func (c *Client) ResolveTokenPath() string {
	if c == nil {
		return DefaultTokenPath()
	}
	if p := filepath.Clean(c.TokenPath); p != "" && p != "." {
		return c.TokenPath
	}
	return DefaultTokenPath()
}

// LoadToken reads tokens from TokenPath into the client (no network).
func (c *Client) LoadToken() error {
	if c == nil {
		return errors.New("google health client not configured")
	}
	path := c.ResolveTokenPath()
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read token file %s: %w", path, err)
	}
	var st storedToken
	if err := json.Unmarshal(data, &st); err != nil {
		return fmt.Errorf("parse token file %s: %w", path, err)
	}
	if st.AccessToken == "" && st.RefreshToken == "" {
		return fmt.Errorf("token file %s has no access_token or refresh_token", path)
	}
	tok := &oauth2.Token{
		AccessToken:  st.AccessToken,
		TokenType:    st.TokenType,
		RefreshToken: st.RefreshToken,
		Expiry:       st.Expiry,
	}
	if tok.TokenType == "" {
		tok.TokenType = "Bearer"
	}
	c.tokenMu().Lock()
	c.token = tok
	c.AccessToken = tok.AccessToken
	c.TokenPath = path
	c.tokenMu().Unlock()
	return nil
}

// SaveToken writes the current token to TokenPath (atomic replace).
func (c *Client) SaveToken(tok *oauth2.Token) error {
	if c == nil {
		return errors.New("google health client not configured")
	}
	if tok == nil {
		return errors.New("nil token")
	}
	path := c.ResolveTokenPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create token directory: %w", err)
	}
	st := storedToken{
		AccessToken:  tok.AccessToken,
		TokenType:    tok.TokenType,
		RefreshToken: tok.RefreshToken,
		Expiry:       tok.Expiry,
	}
	if st.TokenType == "" {
		st.TokenType = "Bearer"
	}
	// Preserve refresh token across refreshes that omit it.
	c.tokenMu().Lock()
	if st.RefreshToken == "" && c.token != nil {
		st.RefreshToken = c.token.RefreshToken
	}
	c.tokenMu().Unlock()

	//nolint:gosec // G117: intentionally persist OAuth tokens to the configured path
	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal tokens: %w", err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("write temp token file: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("rename token file: %w", err)
	}

	c.tokenMu().Lock()
	c.token = tok
	if st.RefreshToken != "" && tok.RefreshToken == "" {
		tok.RefreshToken = st.RefreshToken
		c.token = tok
	}
	c.AccessToken = tok.AccessToken
	c.TokenPath = path
	c.tokenMu().Unlock()
	return nil
}

func (c *Client) oauthConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID:     c.ClientID,
		ClientSecret: c.ClientSecret,
		Endpoint:     oauthEndpoints,
		Scopes:       CoreScopes,
	}
}

// ensureAccessToken refreshes the access token when expired and persists it.
func (c *Client) ensureAccessToken(ctx context.Context) error {
	if err := c.requireAuth(); err != nil {
		// Try loading from disk once if AccessToken empty but path exists.
		if c != nil && c.AccessToken == "" && c.TokenPath != "" {
			if loadErr := c.LoadToken(); loadErr == nil {
				return c.ensureAccessToken(ctx)
			}
		}
		return err
	}
	c.tokenMu().Lock()
	tok := c.token
	c.tokenMu().Unlock()
	if tok == nil {
		// AccessToken set manually (tests) — use as-is.
		return nil
	}
	if tok.Valid() {
		return nil
	}
	if tok.RefreshToken == "" {
		return errors.New("google health access token expired and no refresh_token — run google-health-mcp auth")
	}
	if c.ClientID == "" || c.ClientSecret == "" {
		return errors.New("GOOGLE_HEALTH_CLIENT_ID/SECRET required to refresh tokens")
	}
	src := c.oauthConfig().TokenSource(ctx, tok)
	fresh, err := src.Token()
	if err != nil {
		return fmt.Errorf("refresh Google Health token: %w", err)
	}
	if err := c.SaveToken(fresh); err != nil {
		return err
	}
	return nil
}
