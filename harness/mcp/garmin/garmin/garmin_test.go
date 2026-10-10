package garmin

import (
	"bytes"
	"errors"
	"io"
	"testing"
	"time"
)

func TestClientCreation(t *testing.T) {
	client := New(Options{})
	if client == nil {
		t.Fatal("expected non-nil client")
	}
	if client.Wellness == nil {
		t.Error("expected Wellness service to be initialized")
	}
	if client.Activities == nil {
		t.Error("expected Activities service to be initialized")
	}
}

func TestClientSessionPersistence(t *testing.T) {
	client := New(Options{})
	client.auth = &authState{
		OAuth1Token:       "test-token",
		OAuth1Secret:      "test-secret",
		OAuth2AccessToken: "test-access",
		Domain:            "garmin.com",
	}

	var buf bytes.Buffer
	if err := client.SaveSession(&buf); err != nil {
		t.Fatalf("SaveSession failed: %v", err)
	}

	client2 := New(Options{})
	if err := client2.LoadSession(&buf); err != nil {
		t.Fatalf("LoadSession failed: %v", err)
	}

	if client2.auth.OAuth1Token != "test-token" {
		t.Errorf("token mismatch: got %s", client2.auth.OAuth1Token)
	}
}

func TestCommitOAuth2PersistsSession(t *testing.T) {
	var buf bytes.Buffer
	var calls int
	client := New(Options{})
	client.auth = &authState{
		OAuth2AccessToken:  "old-access",
		OAuth2RefreshToken: "old-refresh",
		DIClientID:         "old-client",
		Domain:             "garmin.com",
	}
	client.SetSessionPersister(func(c *Client) error {
		calls++
		buf.Reset()
		return c.SaveSession(&buf)
	})

	expiry := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	if err := client.commitOAuth2(&OAuth2Token{
		AccessToken:  "new-access",
		RefreshToken: "new-refresh",
		Expiry:       expiry,
		Scope:        "CONNECT_READ",
		ClientID:     "new-client",
	}); err != nil {
		t.Fatalf("commitOAuth2: %v", err)
	}

	if calls != 1 {
		t.Fatalf("expected persister called once, got %d", calls)
	}
	if client.auth.OAuth2AccessToken != "new-access" {
		t.Fatalf("access token not updated: %s", client.auth.OAuth2AccessToken)
	}
	if client.auth.OAuth2RefreshToken != "new-refresh" {
		t.Fatalf("refresh token not updated: %s", client.auth.OAuth2RefreshToken)
	}
	if client.auth.DIClientID != "new-client" {
		t.Fatalf("client id not updated: %s", client.auth.DIClientID)
	}

	loaded := New(Options{})
	if err := loaded.LoadSession(&buf); err != nil {
		t.Fatalf("LoadSession: %v", err)
	}
	if loaded.auth.OAuth2AccessToken != "new-access" || loaded.auth.OAuth2RefreshToken != "new-refresh" {
		t.Fatalf("persisted session mismatch: %+v", loaded.auth)
	}
}

func TestCommitOAuth2PersistError(t *testing.T) {
	client := New(Options{})
	client.SetSessionPersister(func(*Client) error {
		return io.EOF
	})
	err := client.commitOAuth2(&OAuth2Token{AccessToken: "a", RefreshToken: "r"})
	if err == nil {
		t.Fatal("expected persist error")
	}
	if !errors.Is(err, io.EOF) {
		t.Fatalf("expected wrapped io.EOF, got %v", err)
	}
}

func TestClientDefaultDomain(t *testing.T) {
	client := New(Options{})
	if client.opts.Domain != "garmin.com" {
		t.Errorf("expected default domain 'garmin.com', got %s", client.opts.Domain)
	}
}

func TestClientCustomDomain(t *testing.T) {
	client := New(Options{Domain: "garmin.cn"})
	if client.opts.Domain != "garmin.cn" {
		t.Errorf("expected domain 'garmin.cn', got %s", client.opts.Domain)
	}
}

func TestClientCustomRateLimit(t *testing.T) {
	customConfig := &RateLimitConfig{
		RequestsPerMinute: 30,
		BurstSize:         10,
	}
	client := New(Options{RateLimit: customConfig})
	if client == nil {
		t.Fatal("expected non-nil client")
	}
	// Verify the client was created with custom rate limit config
	if client.transport == nil {
		t.Error("expected transport to be initialized")
	}
}

func TestAllServicesInitialized(t *testing.T) {
	client := New(Options{})

	services := []struct {
		name    string
		service any
	}{
		{"Wellness", client.Wellness},
		{"Activities", client.Activities},
		{"Metrics", client.Metrics},
		{"Weight", client.Weight},
		{"Devices", client.Devices},
		{"Workouts", client.Workouts},
		{"Goals", client.Goals},
		{"Badges", client.Badges},
		{"Gear", client.Gear},
		{"Download", client.Download},
		{"Upload", client.Upload},
		{"Hydration", client.Hydration},
		{"BloodPressure", client.BloodPressure},
		{"PersonalRecords", client.PersonalRecords},
		{"Steps", client.Steps},
		{"UserProfile", client.UserProfile},
		{"UserSummary", client.UserSummary},
		{"Golf", client.Golf},
	}

	for _, s := range services {
		if s.service == nil {
			t.Errorf("expected %s service to be initialized", s.name)
		}
	}
}
