package garmin

import (
	"net/url"
	"path/filepath"
	"testing"
	"time"
)

func TestMFAPending_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "mfa_pending.json")
	orig := &MFAPending{
		Domain: "garmin.com",
		LoginParams: url.Values{
			"clientId": {"GCM_IOS_DARK"},
			"locale":   {"en-US"},
		},
		MFAMethod: "email",
		Cookies: []storedCookie{
			{Name: "session", Value: "abc", Path: "/", Secure: true},
		},
		ExpiresAt: time.Now().Add(5 * time.Minute),
	}
	if err := SaveMFAPending(path, orig); err != nil {
		t.Fatal(err)
	}
	got, err := LoadMFAPending(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.Domain != orig.Domain || got.MFAMethod != orig.MFAMethod {
		t.Fatalf("got %+v", got)
	}
	if got.LoginParams.Get("clientId") != "GCM_IOS_DARK" {
		t.Fatalf("login params = %v", got.LoginParams)
	}
	if len(got.Cookies) != 1 || got.Cookies[0].Value != "abc" {
		t.Fatalf("cookies = %+v", got.Cookies)
	}

	jar, err := restoreSSOJar(got.Domain, got.Cookies)
	if err != nil {
		t.Fatal(err)
	}
	u := mustParseURL("https://sso.garmin.com/")
	cookies := jar.Cookies(u)
	if len(cookies) != 1 || cookies[0].Name != "session" {
		t.Fatalf("restored cookies = %+v", cookies)
	}
}

func TestMFAPending_Expired(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "mfa_pending.json")
	if err := SaveMFAPending(path, &MFAPending{
		Domain:    "garmin.com",
		ExpiresAt: time.Now().Add(-time.Minute),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadMFAPending(path); err == nil {
		t.Fatal("expected expiry error")
	}
}

func TestMFAPendingPath(t *testing.T) {
	session := filepath.Join("data", ".config", "garmin", "session.json")
	got := MFAPendingPath(session)
	want := filepath.Join("data", ".config", "garmin", "mfa_pending.json")
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}
