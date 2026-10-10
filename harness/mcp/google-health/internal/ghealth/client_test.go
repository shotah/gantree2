package ghealth

import "testing"

func TestMaybeFromEnv(t *testing.T) {
	t.Setenv("GOOGLE_HEALTH_CLIENT_ID", "cid")
	t.Setenv("GOOGLE_HEALTH_CLIENT_SECRET", "sec")
	t.Setenv("GOOGLE_HEALTH_BASE_URL", "https://example.test/")
	c := MaybeFromEnv()
	if c.ClientID != "cid" || c.ClientSecret != "sec" {
		t.Fatalf("creds %+v", c)
	}
	if c.BaseURL != "https://example.test" {
		t.Fatalf("base %q", c.BaseURL)
	}
}

func TestDataPointsURL(t *testing.T) {
	c := &Client{BaseURL: "https://health.googleapis.com"}
	got := c.dataPointsURL(DataTypeSleep, "reconcile")
	want := "https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestRequireAuth(t *testing.T) {
	c := &Client{}
	if _, err := c.SleepGet(t.Context(), SleepGetRequest{}); err == nil {
		t.Fatal("expected auth error")
	}
}

func TestAccountStatusUnauthed(t *testing.T) {
	t.Setenv("GOOGLE_HEALTH_TOKEN_PATH", "")
	t.Setenv("DATA_DIR", "")
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	c := MaybeFromEnv()
	st := c.AccountStatus()
	if st["authenticated"] != false {
		t.Fatalf("%#v", st)
	}
	if st["provider"] != "Google Health API" {
		t.Fatalf("provider %#v", st["provider"])
	}
}

func TestStub(t *testing.T) {
	s := NewStub()
	ctx := t.Context()
	if _, err := s.SleepGet(ctx, SleepGetRequest{Date: "2026-08-03"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ActivitiesList(ctx, ActivitiesListRequest{}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ActivitiesGet(ctx, "1"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.HeartRateGet(ctx, HeartRateRequest{}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.HRVGet(ctx, HRVRequest{}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.WeightGet(ctx, WeightRequest{}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ProfileGet(ctx); err != nil {
		t.Fatal(err)
	}
}
