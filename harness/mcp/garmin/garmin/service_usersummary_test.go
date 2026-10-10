package garmin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestDailyUserSummaryJSON(t *testing.T) {
	rawJSON := `{
		"userProfileId": 1,
		"calendarDate": "2026-07-15",
		"totalSteps": 8500,
		"dailyStepGoal": 10000,
		"totalKilocalories": 2200,
		"activeKilocalories": 500,
		"totalDistanceMeters": 6200,
		"floorsAscended": 12.5,
		"averageStressLevel": 28,
		"bodyBatteryMostRecentValue": 72
	}`

	var summary DailyUserSummary
	if err := json.Unmarshal([]byte(rawJSON), &summary); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if summary.TotalSteps != 8500 || summary.CalendarDate != "2026-07-15" {
		t.Fatalf("summary = %+v", summary)
	}
	summary.SetRaw(json.RawMessage(rawJSON))
	if string(summary.RawJSON()) != rawJSON {
		t.Error("RawJSON/SetRaw mismatch")
	}
}

func TestStepsDailyStatsJSON(t *testing.T) {
	rawJSON := `[{"calendarDate":"2026-07-14","totalSteps":7000,"stepGoal":10000,"totalDistance":5000}]`
	var stats StepsDailyStats
	if err := json.Unmarshal([]byte(rawJSON), &stats); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if len(stats.Entries) != 1 || stats.Entries[0].TotalSteps != 7000 {
		t.Fatalf("stats = %+v", stats)
	}
}

func TestUserSummaryGetDaily(t *testing.T) {
	body := `{"calendarDate":"2026-07-15","totalSteps":9000,"dailyStepGoal":10000}`
	client := testAuthedClient(t, roundTripFunc(func(r *http.Request) (*http.Response, error) {
		want := "/usersummary-service/usersummary/daily/myuser"
		if !strings.Contains(r.URL.Path, want) {
			t.Errorf("path = %s, want contain %s", r.URL.Path, want)
		}
		if r.URL.Query().Get("calendarDate") != "2026-07-15" {
			t.Errorf("calendarDate = %s", r.URL.Query().Get("calendarDate"))
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     make(http.Header),
		}, nil
	}))

	summary, err := client.UserSummary.GetDaily(
		context.Background(),
		"myuser",
		time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("GetDaily: %v", err)
	}
	if summary.TotalSteps != 9000 {
		t.Fatalf("TotalSteps = %d", summary.TotalSteps)
	}
}

func TestUserSummaryGetHydration(t *testing.T) {
	body := `{"calendarDate":"2026-07-15","valueInML":1500,"goalInML":2500}`
	client := testAuthedClient(t, roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if !strings.HasSuffix(r.URL.Path, "/usersummary-service/usersummary/hydration/daily/2026-07-15") {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     make(http.Header),
		}, nil
	}))

	h, err := client.UserSummary.GetHydration(context.Background(), time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("GetHydration: %v", err)
	}
	if h.ValueInML != 1500 {
		t.Fatalf("ValueInML = %v", h.ValueInML)
	}
}

func TestUserSummaryLogHydration(t *testing.T) {
	client := testAuthedClient(t, roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method != http.MethodPut {
			t.Errorf("method = %s, want PUT", r.Method)
		}
		if !strings.HasSuffix(r.URL.Path, "/usersummary-service/usersummary/hydration/log") {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		payload, _ := io.ReadAll(r.Body)
		var req HydrationLogRequest
		if err := json.Unmarshal(payload, &req); err != nil {
			t.Fatalf("unmarshal body: %v", err)
		}
		if req.ValueInML != 250 {
			t.Errorf("valueInML = %v", req.ValueInML)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader(`{"calendarDate":"2026-07-15","valueInML":1750}`)),
			Header:     make(http.Header),
		}, nil
	}))

	h, err := client.UserSummary.LogHydration(context.Background(), &HydrationLogRequest{
		CalendarDate:   "2026-07-15",
		TimestampLocal: "2026-07-15T12:00:00.000",
		ValueInML:      250,
	})
	if err != nil {
		t.Fatalf("LogHydration: %v", err)
	}
	if h.ValueInML != 1750 {
		t.Fatalf("ValueInML = %v", h.ValueInML)
	}
}

func TestUserSummaryGetStepsDailyChunks(t *testing.T) {
	var calls int
	client := testAuthedClient(t, roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		path := r.URL.Path
		var body string
		switch {
		case strings.Contains(path, "/2026-01-01/2026-01-28"):
			body = `[{"calendarDate":"2026-01-01","totalSteps":1000,"stepGoal":10000,"totalDistance":800}]`
		case strings.Contains(path, "/2026-01-29/2026-02-05"):
			body = `[{"calendarDate":"2026-02-05","totalSteps":2000,"stepGoal":10000,"totalDistance":1600}]`
		default:
			t.Errorf("unexpected path %s", path)
			body = `[]`
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     make(http.Header),
		}, nil
	}))

	stats, err := client.UserSummary.GetStepsDaily(
		context.Background(),
		time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 2, 5, 0, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("GetStepsDaily: %v", err)
	}
	if calls != 2 {
		t.Fatalf("calls = %d, want 2", calls)
	}
	if len(stats.Entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(stats.Entries))
	}
}

func TestUserSummaryWeeklyAndStatsPaths(t *testing.T) {
	seen := map[string]bool{}
	client := testAuthedClient(t, roundTripFunc(func(r *http.Request) (*http.Response, error) {
		seen[r.URL.Path] = true
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader(`[{"calendarDate":"2026-07-15","value":30,"totalSteps":1,"weeklyGoal":150,"moderateValue":10,"vigorousValue":5,"valueInML":1000}]`)),
			Header:     make(http.Header),
		}, nil
	}))

	ctx := context.Background()
	start := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 7, 15, 0, 0, 0, 0, time.UTC)

	if _, err := client.UserSummary.GetStepsWeekly(ctx, end, 4); err != nil {
		t.Fatalf("GetStepsWeekly: %v", err)
	}
	if _, err := client.UserSummary.GetStressDaily(ctx, start, end); err != nil {
		t.Fatalf("GetStressDaily: %v", err)
	}
	if _, err := client.UserSummary.GetStressWeekly(ctx, end, 4); err != nil {
		t.Fatalf("GetStressWeekly: %v", err)
	}
	if _, err := client.UserSummary.GetHydrationStats(ctx, start, end); err != nil {
		t.Fatalf("GetHydrationStats: %v", err)
	}
	if _, err := client.UserSummary.GetIntensityMinutesDaily(ctx, start, end); err != nil {
		t.Fatalf("GetIntensityMinutesDaily: %v", err)
	}
	if _, err := client.UserSummary.GetIntensityMinutesWeekly(ctx, start, end); err != nil {
		t.Fatalf("GetIntensityMinutesWeekly: %v", err)
	}

	wantPaths := []string{
		"/usersummary-service/stats/steps/weekly/2026-07-15/4",
		"/usersummary-service/stats/stress/daily/2026-07-01/2026-07-15",
		"/usersummary-service/stats/stress/weekly/2026-07-15/4",
		"/usersummary-service/stats/hydration/daily/2026-07-01/2026-07-15",
		"/usersummary-service/stats/im/daily/2026-07-01/2026-07-15",
		"/usersummary-service/stats/im/weekly/2026-07-01/2026-07-15",
	}
	for _, p := range wantPaths {
		if !seen[p] {
			t.Errorf("missing request path %s; seen=%v", p, seen)
		}
	}
}

func TestUserSummaryValidationErrors(t *testing.T) {
	client := New(Options{})
	ctx := context.Background()

	if _, err := client.UserSummary.LogHydration(ctx, nil); err == nil {
		t.Error("expected error for nil hydration request")
	}
	if _, err := client.UserSummary.GetStepsWeekly(ctx, time.Now(), 0); err == nil {
		t.Error("expected error for weeks < 1")
	}
	if _, err := client.UserSummary.GetStepsDaily(
		ctx,
		time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),
	); err == nil {
		t.Error("expected error for end before start")
	}
}
