package garmin

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

const (
	mfaPendingFileName = "mfa_pending.json"
	mfaPendingTTL      = 10 * time.Minute
)

// MFAPending holds cookie jar + MFA context between chat /auth garmin and
// /auth garmin <code> (separate processes).
type MFAPending struct {
	Domain      string         `json:"domain"`
	LoginParams url.Values     `json:"login_params"`
	MFAMethod   string         `json:"mfa_method"`
	Cookies     []storedCookie `json:"cookies"`
	ExpiresAt   time.Time      `json:"expires_at"`
}

type storedCookie struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	Path     string `json:"path,omitempty"`
	Domain   string `json:"domain,omitempty"`
	Secure   bool   `json:"secure,omitempty"`
	HTTPOnly bool   `json:"http_only,omitempty"`
}

// MFAPendingPath is next to session.json under the garmin config dir.
func MFAPendingPath(sessionPath string) string {
	return filepath.Join(filepath.Dir(sessionPath), mfaPendingFileName)
}

// SaveMFAPending writes pending MFA state (0600).
func SaveMFAPending(path string, p *MFAPending) error {
	if p == nil {
		return errors.New("garmin: nil MFA pending")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

// LoadMFAPending reads pending MFA state. Expired files are removed.
func LoadMFAPending(path string) (*MFAPending, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, errors.New("garmin: no pending MFA (run 'garmin login url' / /auth garmin first)")
		}
		return nil, err
	}
	var p MFAPending
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("garmin: corrupt MFA pending: %w", err)
	}
	if time.Now().After(p.ExpiresAt) {
		_ = os.Remove(path)
		return nil, errors.New("garmin: MFA pending expired — run /auth garmin again")
	}
	if p.Domain == "" {
		p.Domain = defaultDomain
	}
	if p.MFAMethod == "" {
		p.MFAMethod = "email"
	}
	return &p, nil
}

// ClearMFAPending removes the pending file if present.
func ClearMFAPending(path string) {
	_ = os.Remove(path)
}

func dumpSSOCookies(jar http.CookieJar, domain string) []storedCookie {
	if jar == nil {
		return nil
	}
	urls := []*url.URL{
		mustParseURL("https://sso." + domain + "/"),
		mustParseURL("https://sso." + domain + "/mobile/api/login"),
		mustParseURL("https://sso." + domain + "/mobile/api/mfa/verifyCode"),
	}
	seen := map[string]struct{}{}
	var out []storedCookie
	for _, u := range urls {
		for _, c := range jar.Cookies(u) {
			key := c.Name + "|" + c.Value + "|" + c.Path
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, storedCookie{
				Name:     c.Name,
				Value:    c.Value,
				Path:     c.Path,
				Domain:   c.Domain,
				Secure:   c.Secure,
				HTTPOnly: c.HttpOnly,
			})
		}
	}
	return out
}

func restoreSSOJar(domain string, cookies []storedCookie) (http.CookieJar, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	if len(cookies) == 0 {
		return jar, nil
	}
	u := mustParseURL("https://sso." + domain + "/")
	list := make([]*http.Cookie, 0, len(cookies))
	for _, c := range cookies {
		list = append(list, &http.Cookie{
			Name:     c.Name,
			Value:    c.Value,
			Path:     c.Path,
			Domain:   c.Domain,
			Secure:   true,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
		})
	}
	jar.SetCookies(u, list)
	return jar, nil
}

func mustParseURL(raw string) *url.URL {
	u, err := url.Parse(raw)
	if err != nil {
		panic(err)
	}
	return u
}
