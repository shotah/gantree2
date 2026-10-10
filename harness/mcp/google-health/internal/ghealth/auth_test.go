package ghealth

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

func TestRunAuthSuccess(t *testing.T) {
	oauthSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"access-from-auth","refresh_token":"refresh-from-auth","token_type":"Bearer","expires_in":3600}`))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(oauthSrv.Close)

	apiSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/identity") {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"legacyUserId": "FB",
				"healthUserId": "GH",
			})
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(apiSrv.Close)

	oldEP := oauthEndpoints
	oauthEndpoints = oauth2.Endpoint{
		AuthURL:  oauthSrv.URL + "/auth",
		TokenURL: oauthSrv.URL,
	}
	t.Cleanup(func() { oauthEndpoints = oldEP })

	cbLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	cbPort := cbLn.Addr().(*net.TCPAddr).Port
	oldListen := listenCallback
	listenCallback = func() (net.Listener, error) { return cbLn, nil }
	t.Cleanup(func() { listenCallback = oldListen })

	oldOpen := openBrowser
	openBrowser = func(authURL string) error {
		u, err := url.Parse(authURL)
		if err != nil {
			return err
		}
		state := u.Query().Get("state")
		go func() {
			time.Sleep(40 * time.Millisecond)
			cb := "http://127.0.0.1:" + strconv.Itoa(cbPort) + "/oauth2callback?code=test-code&state=" + url.QueryEscape(state)
			resp, err := http.Get(cb) //nolint:gosec // G704: test-only loopback callback
			if err == nil {
				_, _ = io.Copy(io.Discard, resp.Body)
				_ = resp.Body.Close()
			}
		}()
		return nil
	}
	t.Cleanup(func() { openBrowser = oldOpen })

	path := filepath.Join(t.TempDir(), "tokens.json")
	c := &Client{
		ClientID:     "cid",
		ClientSecret: "sec",
		TokenPath:    path,
		BaseURL:      apiSrv.URL,
		HTTPClient:   apiSrv.Client(),
		mu:           &sync.Mutex{},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := RunAuth(ctx, c); err != nil {
		t.Fatal(err)
	}
	if c.AccessToken != "access-from-auth" {
		t.Fatalf("token %q", c.AccessToken)
	}
}

func TestRunAuthMissingCreds(t *testing.T) {
	if err := RunAuth(t.Context(), &Client{}); err == nil {
		t.Fatal("expected error")
	}
}

func TestRunAuthNilClient(t *testing.T) {
	if err := RunAuth(t.Context(), nil); err == nil {
		t.Fatal("expected error")
	}
}

func TestRunAuthStateMismatch(t *testing.T) {
	oldEP := oauthEndpoints
	oauthEndpoints = oauth2.Endpoint{
		AuthURL:  "http://127.0.0.1/auth",
		TokenURL: "http://127.0.0.1/token",
	}
	t.Cleanup(func() { oauthEndpoints = oldEP })

	cbLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	cbPort := cbLn.Addr().(*net.TCPAddr).Port
	oldListen := listenCallback
	listenCallback = func() (net.Listener, error) { return cbLn, nil }
	t.Cleanup(func() { listenCallback = oldListen })

	oldOpen := openBrowser
	openBrowser = func(string) error {
		go func() {
			time.Sleep(40 * time.Millisecond)
			cb := "http://127.0.0.1:" + strconv.Itoa(cbPort) + "/oauth2callback?code=x&state=wrong"
			resp, err := http.Get(cb) //nolint:gosec // G704: test-only loopback callback
			if err == nil {
				_, _ = io.Copy(io.Discard, resp.Body)
				_ = resp.Body.Close()
			}
		}()
		return nil
	}
	t.Cleanup(func() { openBrowser = oldOpen })

	c := &Client{
		ClientID:     "cid",
		ClientSecret: "sec",
		TokenPath:    filepath.Join(t.TempDir(), "t.json"),
		mu:           &sync.Mutex{},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := RunAuth(ctx, c); err == nil {
		t.Fatal("expected state mismatch error")
	}
}
