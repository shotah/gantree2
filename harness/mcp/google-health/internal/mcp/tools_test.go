package mcp

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"

	"github.com/shotah/google-health-mcp/internal/ghealth"
)

var toolNameRE = regexp.MustCompile(`^[a-z]+(_[a-z0-9]+)+$`)

func TestRegisteredToolNames(t *testing.T) {
	names := RegisteredToolNames()
	if len(names) != 8 {
		t.Fatalf("want 8 tools, got %d: %v", len(names), names)
	}
	for _, n := range names {
		if strings.HasPrefix(n, "ghealth_") || strings.HasPrefix(n, "health_") || strings.HasPrefix(n, "fitbit_") {
			t.Fatalf("tool %q must not start with host/provider prefix", n)
		}
		if !toolNameRE.MatchString(n) {
			t.Fatalf("tool %q bad pattern", n)
		}
	}
}

func TestSelfTest(t *testing.T) {
	if err := SelfTest(); err != nil {
		t.Fatal(err)
	}
}

func TestAllToolsStub(t *testing.T) {
	s := New(ghealth.NewStub())
	ctx := t.Context()

	if res, out, err := s.sleepGet(ctx, nil, sleepGetInput{Date: "2026-08-03"}); err != nil || (res != nil && res.IsError) || out == nil {
		t.Fatalf("sleep %v %v %v", res, out, err)
	}
	if res, out, err := s.activitiesList(ctx, nil, activitiesListInput{}); err != nil || (res != nil && res.IsError) || out == nil {
		t.Fatalf("activities_list %v %v %v", res, out, err)
	}
	if res, out, err := s.activitiesGet(ctx, nil, activitiesGetInput{ActivityID: "1"}); err != nil || (res != nil && res.IsError) || out == nil {
		t.Fatalf("activities_get %v %v %v", res, out, err)
	}
	if res, out, err := s.heartRateGet(ctx, nil, heartRateGetInput{}); err != nil || (res != nil && res.IsError) || out == nil {
		t.Fatalf("heart_rate %v %v %v", res, out, err)
	}
	if res, out, err := s.hrvGet(ctx, nil, hrvGetInput{}); err != nil || (res != nil && res.IsError) || out == nil {
		t.Fatalf("hrv %v %v %v", res, out, err)
	}
	if res, out, err := s.weightGet(ctx, nil, weightGetInput{Period: "1m"}); err != nil || (res != nil && res.IsError) || out == nil {
		t.Fatalf("weight %v %v %v", res, out, err)
	}
	if res, out, err := s.profileGet(ctx, nil, profileGetInput{}); err != nil || (res != nil && res.IsError) || out == nil {
		t.Fatalf("profile %v %v %v", res, out, err)
	}
	if _, out, err := s.accountGet(ctx, nil, accountGetInput{}); err != nil {
		t.Fatal(err)
	} else if m, ok := out.(map[string]any); !ok || m["provider"] != "Google Health API" {
		t.Fatalf("%#v", out)
	}
}

func TestActivitiesGetRequiresID(t *testing.T) {
	s := New(ghealth.NewStub())
	res, _, err := s.activitiesGet(t.Context(), nil, activitiesGetInput{})
	if err != nil {
		t.Fatal(err)
	}
	if res == nil || !res.IsError {
		t.Fatal("expected error")
	}
}

func TestToolsNilClient(t *testing.T) {
	s := New(nil)
	ctx := t.Context()
	if res, _, _ := s.sleepGet(ctx, nil, sleepGetInput{}); res == nil || !res.IsError {
		t.Fatal("expected client error")
	}
	if res, _, _ := s.activitiesList(ctx, nil, activitiesListInput{}); res == nil || !res.IsError {
		t.Fatal("expected client error")
	}
	if res, _, _ := s.activitiesGet(ctx, nil, activitiesGetInput{ActivityID: "x"}); res == nil || !res.IsError {
		t.Fatal("expected client error")
	}
	if res, _, _ := s.heartRateGet(ctx, nil, heartRateGetInput{}); res == nil || !res.IsError {
		t.Fatal("expected client error")
	}
	if res, _, _ := s.hrvGet(ctx, nil, hrvGetInput{}); res == nil || !res.IsError {
		t.Fatal("expected client error")
	}
	if res, _, _ := s.weightGet(ctx, nil, weightGetInput{}); res == nil || !res.IsError {
		t.Fatal("expected client error")
	}
	if res, _, _ := s.profileGet(ctx, nil, profileGetInput{}); res == nil || !res.IsError {
		t.Fatal("expected client error")
	}
	_, out, err := s.accountGet(ctx, nil, accountGetInput{})
	if err != nil {
		t.Fatal(err)
	}
	m := out.(map[string]any)
	if m["authenticated"] != false {
		t.Fatalf("%#v", m)
	}
}

type errClient struct{ ghealth.Stub }

func (errClient) SleepGet(_ context.Context, _ ghealth.SleepGetRequest) (*ghealth.SleepListResult, error) {
	return nil, errors.New("boom")
}

func TestToolPropagatesClientError(t *testing.T) {
	s := New(errClient{})
	res, _, err := s.sleepGet(t.Context(), nil, sleepGetInput{})
	if err != nil {
		t.Fatal(err)
	}
	if res == nil || !res.IsError {
		t.Fatal("expected tool error result")
	}
}
