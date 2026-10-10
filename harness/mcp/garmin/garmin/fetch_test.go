package garmin

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func testAuthedClient(t *testing.T, rt http.RoundTripper) *Client {
	t.Helper()
	client := New(Options{
		HTTPClient: &http.Client{Transport: rt},
		RateLimit:  &RateLimitConfig{RequestsPerMinute: 60000, BurstSize: 1000},
	})
	client.auth = &authState{
		OAuth2AccessToken:  "test-access",
		OAuth2RefreshToken: "test-refresh",
		OAuth2Expiry:       time.Now().Add(time.Hour),
		Domain:             "garmin.com",
	}
	return client
}

func TestFetch_SuccessAndRawJSON(t *testing.T) {
	body := `[{"calendarDate":"2026-01-15","values":{"fitnessAge":30,"rhr":50,"bmi":22,"achievableFitnessAge":28,"vigorousDaysAvg":2}}]`
	client := testAuthedClient(t, roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if !strings.Contains(r.URL.Path, "/fitnessage-service/stats/daily/") {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     make(http.Header),
		}, nil
	}))

	stats, err := client.FitnessAge.GetStatsDaily(
		context.Background(),
		time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2026, 1, 31, 0, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("GetStatsDaily: %v", err)
	}
	if len(stats.Entries) != 1 || stats.Entries[0].Values.FitnessAge != 30 {
		t.Fatalf("stats = %+v", stats)
	}
	if string(stats.RawJSON()) != body {
		t.Error("RawJSON should preserve response body")
	}
}

func TestFetch_NotFoundStatuses(t *testing.T) {
	for _, code := range []int{http.StatusNoContent, http.StatusNotFound} {
		t.Run(http.StatusText(code), func(t *testing.T) {
			client := testAuthedClient(t, roundTripFunc(func(*http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: code,
					Status:     http.StatusText(code),
					Body:       io.NopCloser(strings.NewReader("")),
					Header:     make(http.Header),
				}, nil
			}))
			_, err := client.FitnessAge.GetStatsDaily(
				context.Background(),
				time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
				time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC),
			)
			if !IsNotFound(err) {
				t.Fatalf("err = %v, want ErrNotFound", err)
			}
		})
	}
}

func TestSendEmpty_SuccessAndError(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		client := testAuthedClient(t, roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusNoContent,
				Status:     "204 No Content",
				Body:       io.NopCloser(strings.NewReader("")),
				Header:     make(http.Header),
			}, nil
		}))
		if err := sendEmpty(context.Background(), client, http.MethodDelete, "/course-service/course/1"); err != nil {
			t.Fatalf("sendEmpty: %v", err)
		}
	})

	t.Run("error", func(t *testing.T) {
		client := testAuthedClient(t, roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusBadRequest,
				Status:     "400 Bad Request",
				Body:       io.NopCloser(strings.NewReader(`{"error":"nope"}`)),
				Header:     make(http.Header),
			}, nil
		}))
		err := sendEmpty(context.Background(), client, http.MethodDelete, "/course-service/course/1")
		var apiErr *APIError
		if !errors.As(err, &apiErr) || apiErr.StatusCode != http.StatusBadRequest {
			t.Fatalf("err = %v", err)
		}
	})
}

func TestFitnessStatsService_GetWithHTTP(t *testing.T) {
	statsBody := `[{"date":"2026-01-01","countOfActivities":1,"stats":{"all":{"distance":{"count":1,"min":1,"max":1,"avg":1,"sum":1}}}}]`
	actsBody := `[{"activityId":9,"name":"Run"}]`
	var sawPath string
	client := testAuthedClient(t, roundTripFunc(func(r *http.Request) (*http.Response, error) {
		sawPath = r.URL.Path + "?" + r.URL.RawQuery
		body := statsBody
		if strings.Contains(r.URL.Path, "/activity/all") {
			body = actsBody
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     make(http.Header),
		}, nil
	}))

	opts := &FitnessStatsOptions{
		Aggregation: AggregationWeekly,
		StartDate:   time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		EndDate:     time.Date(2026, 1, 31, 0, 0, 0, 0, time.UTC),
		Metrics:     []FitnessMetric{MetricDistance},
	}
	stats, err := client.FitnessStats.GetActivityStats(context.Background(), opts)
	if err != nil {
		t.Fatalf("GetActivityStats: %v", err)
	}
	if len(stats.Entries) != 1 {
		t.Fatalf("entries = %d", len(stats.Entries))
	}
	if !strings.Contains(sawPath, "/fitnessstats-service/activity?") {
		t.Errorf("path = %s", sawPath)
	}

	acts, err := client.FitnessStats.GetAllActivities(context.Background(), opts)
	if err != nil {
		t.Fatalf("GetAllActivities: %v", err)
	}
	if len(acts.Activities) != 1 || acts.Activities[0].ActivityID != 9 {
		t.Fatalf("activities = %+v", acts.Activities)
	}
}

func TestMetricsService_GetRacePredictionsLatest(t *testing.T) {
	body := `{"userId":1,"calendarDate":"2026-01-15","time5K":1000,"time10K":2000,"timeHalfMarathon":3000,"timeMarathon":4000}`
	client := testAuthedClient(t, roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if !strings.HasSuffix(r.URL.Path, "/racepredictions/latest/anonymous") {
			t.Errorf("path = %s", r.URL.Path)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     make(http.Header),
		}, nil
	}))

	rp, err := client.Metrics.GetRacePredictionsLatest(context.Background(), "anonymous")
	if err != nil {
		t.Fatalf("GetRacePredictionsLatest: %v", err)
	}
	if rp.Time5K != 1000 || rp.Time5KDuration() != 1000*time.Second {
		t.Fatalf("rp = %+v", rp)
	}
}

func TestWellnessService_NewEndpointsHTTP(t *testing.T) {
	date := time.Date(2026, 1, 27, 0, 0, 0, 0, time.UTC)
	client := testAuthedClient(t, roundTripFunc(func(r *http.Request) (*http.Response, error) {
		path := r.URL.Path
		query := r.URL.RawQuery
		var body string
		switch {
		case strings.Contains(path, "/dailyEvents"):
			if query != "calendarDate=2026-01-27" {
				t.Errorf("dailyEvents query = %q", query)
			}
			body = `{"calendarDate":"2026-01-27"}`
		case strings.Contains(path, "/dailySleepData/"):
			body = `{"dailySleepDTO":{"calendarDate":"2026-01-27","sleepTimeSeconds":28800}}`
		case strings.Contains(path, "/dailySummaryChart/"):
			body = `[{"startGMT":"a","endGMT":"b","steps":10,"pushes":0,"primaryActivityLevel":"active"}]`
		case strings.Contains(path, "/floorsChartData/daily/"):
			body = `{"floorValuesArray":[]}`
		case strings.Contains(path, "/bodyBattery/reports/daily"):
			body = `[{"date":"2026-01-27","charged":1,"drained":2}]`
		case strings.Contains(path, "/sleep/score/"):
			body = `[{"calendarDate":"2026-01-27","value":80}]`
		default:
			t.Fatalf("unexpected path %s", path)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     make(http.Header),
		}, nil
	}))

	if _, err := client.Wellness.GetDailyEvents(context.Background(), date); err != nil {
		t.Fatalf("GetDailyEvents: %v", err)
	}
	if _, err := client.Wellness.GetDailySleep(context.Background(), "anonymous", date); err != nil {
		t.Fatalf("GetDailySleep: %v", err)
	}
	if chart, err := client.Wellness.GetDailySummaryChart(context.Background(), "anonymous", date); err != nil || len(chart.Intervals) != 1 {
		t.Fatalf("GetDailySummaryChart: %v %+v", err, chart)
	}
	if _, err := client.Wellness.GetDailyFloors(context.Background(), date); err != nil {
		t.Fatalf("GetDailyFloors: %v", err)
	}
	if reports, err := client.Wellness.GetBodyBatteryReports(context.Background(), date, date); err != nil || len(reports.Reports) != 1 {
		t.Fatalf("GetBodyBatteryReports: %v %+v", err, reports)
	}
	if scores, err := client.Wellness.GetSleepScoreStats(context.Background(), date, date); err != nil || len(scores.Entries) != 1 {
		t.Fatalf("GetSleepScoreStats: %v %+v", err, scores)
	}
}

func TestResolveDisplayName(t *testing.T) {
	client := New(Options{})
	got, err := client.ResolveDisplayName(context.Background(), "explicit")
	if err != nil || got != "explicit" {
		t.Fatalf("override: got %q err %v", got, err)
	}
}

func TestSend_Success(t *testing.T) {
	// send needs a response type with SetRaw — FitnessAgeStats works if we POST JSON array.
	client := testAuthedClient(t, roundTripFunc(func(*http.Request) (*http.Response, error) {
		body := `[{"calendarDate":"2026-01-01","values":{"fitnessAge":1,"rhr":1,"bmi":1,"achievableFitnessAge":1,"vigorousDaysAvg":1}}]`
		return &http.Response{
			StatusCode: http.StatusCreated,
			Status:     "201 Created",
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     make(http.Header),
		}, nil
	}))

	got, err := send[FitnessAgeStats, *FitnessAgeStats](context.Background(), client, http.MethodPost, "/test", map[string]string{"name": "x"})
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	if len(got.Entries) != 1 {
		t.Fatalf("entries = %d", len(got.Entries))
	}
	if !json.Valid(got.RawJSON()) {
		t.Error("expected valid RawJSON")
	}
}
