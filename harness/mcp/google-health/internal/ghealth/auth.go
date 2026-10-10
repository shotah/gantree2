package ghealth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"

	"golang.org/x/oauth2"
)

const (
	oauthTimeout             = 5 * time.Minute
	readHeaderTimeout        = 10 * time.Second
	defaultOAuthCallbackPort = 4101 // distinct from google-mcp Workspace auth (:4100)
	googleAuthURL            = "https://accounts.google.com/o/oauth2/auth"
	//nolint:gosec // G101: OAuth token endpoint URL, not a credential
	googleTokenURL = "https://oauth2.googleapis.com/token"
)

// openBrowser opens url in the default browser (overridable in tests).
var openBrowser = openBrowserOS

// listenCallback binds the OAuth callback (overridable in tests).
// Default: fixed port on all interfaces so Docker can publish
// -p 127.0.0.1:4101:4101; redirect_uri stays http://127.0.0.1:<port>/…
var listenCallback = func() (net.Listener, error) {
	port := defaultOAuthCallbackPort
	if raw := strings.TrimSpace(os.Getenv("GOOGLE_HEALTH_OAUTH_PORT")); raw != "" {
		if p, err := strconv.Atoi(raw); err == nil && p > 0 && p < 65536 {
			port = p
		}
	}
	host := strings.TrimSpace(os.Getenv("GOOGLE_HEALTH_OAUTH_BIND"))
	if host == "" {
		host = "0.0.0.0"
	}
	ln, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		// Fixed port busy — ephemeral fallback (Docker -p may not match).
		fmt.Fprintf(os.Stderr, "oauth: port %d busy; using ephemeral (%v)\n", port, err)
		return net.Listen("tcp", net.JoinHostPort(host, "0"))
	}
	return ln, nil
}

// oauthEndpoints are overridable in tests (fake auth/token servers).
var oauthEndpoints = oauth2.Endpoint{
	AuthURL:  googleAuthURL,
	TokenURL: googleTokenURL,
}

type callbackResult struct {
	code string
	err  error
}

// RunAuth runs interactive Google OAuth (authorization code + PKCE) and
// writes tokens to GOOGLE_HEALTH_TOKEN_PATH (or the default config path).
func RunAuth(ctx context.Context, c *Client) error {
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

	ln, err := listenCallback()
	if err != nil {
		return fmt.Errorf("listen for OAuth callback: %w", err)
	}
	tcpAddr, ok := ln.Addr().(*net.TCPAddr)
	if !ok {
		_ = ln.Close()
		return errors.New("unexpected OAuth listener address type")
	}
	// Loopback redirect for Google's OAuth client (port matches the listener).
	redirectURI := fmt.Sprintf("http://127.0.0.1:%d/oauth2callback", tcpAddr.Port)

	cfg := c.oauthConfig()
	cfg.RedirectURL = redirectURI

	authURL := cfg.AuthCodeURL(state,
		oauth2.AccessTypeOffline,
		oauth2.S256ChallengeOption(verifier),
		oauth2.SetAuthURLParam("prompt", "consent"),
	)

	resultCh := make(chan callbackResult, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth2callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if errParam := q.Get("error"); errParam != "" {
			resultCh <- callbackResult{err: fmt.Errorf("google returned error: %s", errParam)}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprintf(w, "<html><body><h1>Authentication Failed</h1><p>%s</p><p>You can close this window.</p></body></html>", html.EscapeString(errParam))
			return
		}
		if q.Get("state") != state {
			resultCh <- callbackResult{err: errors.New("OAuth state mismatch — possible CSRF")}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(w, "<html><body><h1>Authentication Failed</h1><p>State mismatch.</p></body></html>")
			return
		}
		code := q.Get("code")
		if code == "" {
			resultCh <- callbackResult{err: errors.New("no authorization code received")}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(w, "<html><body><h1>Authentication Failed</h1><p>No code.</p></body></html>")
			return
		}
		resultCh <- callbackResult{code: code}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, "<html><body><h1>Authentication Successful!</h1><p>You can close this window and return to the application.</p></body></html>")
	})

	srv := &http.Server{Handler: mux, ReadHeaderTimeout: readHeaderTimeout}
	go func() {
		if serveErr := srv.Serve(ln); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			resultCh <- callbackResult{err: fmt.Errorf("OAuth callback server: %w", serveErr)}
		}
	}()
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	fmt.Fprintln(os.Stderr, "Authorize google-health-mcp in your browser.")
	fmt.Fprintf(os.Stderr, "If the browser does not open, visit:\n\n%s\n\n", authURL)
	if err := openBrowser(authURL); err != nil {
		fmt.Fprintf(os.Stderr, "Could not open browser automatically: %v\n", err)
	}

	oauthCtx := ctx
	if oauthCtx == nil {
		oauthCtx = context.Background()
	}

	var result callbackResult
	select {
	case result = <-resultCh:
	case <-time.After(oauthTimeout):
		return errors.New("OAuth callback timed out after 5 minutes — run google-health-mcp auth again")
	case <-oauthCtx.Done():
		return oauthCtx.Err()
	}
	if result.err != nil {
		return result.err
	}

	tok, err := cfg.Exchange(oauthCtx, result.code, oauth2.VerifierOption(verifier))
	if err != nil {
		return fmt.Errorf("OAuth token exchange: %w", err)
	}
	if err := c.SaveToken(tok); err != nil {
		return err
	}

	// Validate end-to-end via getIdentity.
	prof, err := c.ProfileGet(oauthCtx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Tokens saved to %s (identity check failed: %v)\n", c.ResolveTokenPath(), err)
		return nil
	}
	who := prof.GoogleUser
	if who == "" {
		who = prof.FitbitUser
	}
	if who == "" {
		who = "Google Health user"
	}
	fmt.Fprintf(os.Stderr, "Authenticated as %s\n", who)
	fmt.Fprintf(os.Stderr, "Tokens written to %s\n", c.ResolveTokenPath())
	fmt.Fprintln(os.Stderr, "Export GOOGLE_HEALTH_TOKEN_PATH to that path if it is not already set.")
	return nil
}

func openBrowserOS(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}
