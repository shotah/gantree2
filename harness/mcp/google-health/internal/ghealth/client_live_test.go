package ghealth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func testClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return &Client{
		BaseURL:         srv.URL,
		HTTPClient:      srv.Client(),
		AccessToken:     "test-token",
		PreferWearables: true,
		mu:              &sync.Mutex{},
	}
}

func TestSleepGetReconcile(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/dataTypes/sleep/dataPoints:reconcile") {
			t.Fatalf("path %s", r.URL.Path)
		}
		if r.URL.Query().Get("dataSourceFamily") != DataSourceFamilyGoogleWearables {
			t.Fatalf("family %q", r.URL.Query().Get("dataSourceFamily"))
		}
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Fatalf("auth %q", r.Header.Get("Authorization"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"dataPoints": []map[string]any{
				{
					"name": "users/me/dataTypes/sleep/dataPoints/abc",
					"sleep": map[string]any{
						"interval": map[string]any{
							"startTime": "2026-08-02T22:00:00Z",
							"endTime":   "2026-08-03T06:00:00Z",
						},
						"metadata": map[string]any{"mainSleep": true, "processed": true},
						"summary": map[string]any{
							"minutesAsleep":        "420",
							"minutesInSleepPeriod": "480",
							"minutesAwake":         "60",
							"minutesToFallAsleep":  "12",
							"stagesSummary": []any{
								map[string]any{"type": "DEEP", "minutes": "90"},
								map[string]any{"type": "LIGHT", "minutes": "210"},
								map[string]any{"type": "REM", "minutes": "120"},
								map[string]any{"type": "AWAKE", "minutes": "60"},
							},
						},
					},
				},
			},
		})
	})
	res, err := c.SleepGet(t.Context(), SleepGetRequest{Date: "2026-08-03"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Count != 1 || len(res.Sessions) != 1 {
		t.Fatalf("count %#v", res)
	}
	session := res.Sessions[0]
	if session.DurationMinutes != 420 || !session.Main {
		t.Fatalf("session %#v", session)
	}
	if session.Efficiency != 88 {
		t.Fatalf("efficiency %v", session.Efficiency)
	}
	if session.StagesMinutes["deep"] != 90 || session.MinutesToFallAsleep != 12 {
		t.Fatalf("stages %#v", session)
	}
	if session.SleepScore != nil {
		t.Fatalf("score should be absent: %#v", session.SleepScore)
	}
	if !strings.Contains(res.Note, "does not return the app Sleep Score") {
		t.Fatalf("note %q", res.Note)
	}
}

func TestSleepRangePagesAndScore(t *testing.T) {
	var calls int
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		q := r.URL.Query().Get("filter")
		if !strings.Contains(q, `civil_end_time >= "2026-08-01"`) || !strings.Contains(q, `civil_end_time < "2026-08-04"`) {
			t.Fatalf("filter %q", q)
		}
		if calls == 1 {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"nextPageToken": "page-2",
				"dataPoints": []map[string]any{{
					"dataPointName": "users/me/dataTypes/sleep/dataPoints/nap",
					"sleep": map[string]any{
						"interval": map[string]any{
							"endTime": "2026-08-02T18:00:00Z",
							"civilEndTime": map[string]any{
								"date": map[string]any{"year": 2026, "month": 8, "day": 2},
							},
						},
						"metadata": map[string]any{"nap": true},
						"summary":  map[string]any{"minutesAsleep": "40", "minutesInSleepPeriod": "45"},
					},
				}},
			})
			return
		}
		if r.URL.Query().Get("pageToken") != "page-2" {
			t.Fatalf("page token %q", r.URL.Query().Get("pageToken"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"dataPoints": []map[string]any{{
				"dataPointName": "users/me/dataTypes/sleep/dataPoints/main",
				"sleep": map[string]any{
					"interval": map[string]any{
						"endTime": "2026-08-03T14:00:00Z",
						"civilEndTime": map[string]any{
							"date": map[string]any{"year": 2026, "month": 8, "day": 3},
						},
					},
					"metadata": map[string]any{"mainSleep": true},
					"summary": map[string]any{
						"minutesAsleep":        "400",
						"minutesInSleepPeriod": "450",
						"sleepScore":           "81",
					},
				},
			}},
		})
	})
	res, err := c.SleepGet(t.Context(), SleepGetRequest{AfterDate: "2026-08-01", BeforeDate: "2026-08-04"})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 || res.Count != 2 {
		t.Fatalf("calls %d %#v", calls, res)
	}
	if res.Sessions[0].Date != "2026-08-02" || !res.Sessions[0].Nap || res.Sessions[0].Main {
		t.Fatalf("first %#v", res.Sessions[0])
	}
	if res.Sessions[1].Date != "2026-08-03" || !res.Sessions[1].Main || res.Sessions[1].SleepScore == nil || *res.Sessions[1].SleepScore != 81 {
		t.Fatalf("second %#v", res.Sessions[1])
	}
}

func TestDailyRange(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("filter")
		if !strings.Contains(q, "date >= date(2026, 8, 1)") || !strings.Contains(q, "date < date(2026, 8, 4)") {
			t.Fatalf("filter %q", q)
		}
		switch {
		case strings.Contains(r.URL.Path, "daily-resting-heart-rate"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"dataPoints": []map[string]any{
					{"dailyRestingHeartRate": map[string]any{"date": map[string]any{"year": 2026, "month": 8, "day": 3}, "beatsPerMinute": "55"}},
					{"dailyRestingHeartRate": map[string]any{"date": map[string]any{"year": 2026, "month": 8, "day": 1}, "beatsPerMinute": "52"}},
				},
			})
		case strings.Contains(r.URL.Path, "daily-heart-rate-variability"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"dataPoints": []map[string]any{
					{"dailyHeartRateVariability": map[string]any{"date": map[string]any{"year": 2026, "month": 8, "day": 2}, "averageHeartRateVariabilityMilliseconds": 40}},
					{"dailyHeartRateVariability": map[string]any{"date": map[string]any{"year": 2026, "month": 8, "day": 1}, "deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds": 38}},
				},
			})
		default:
			http.NotFound(w, r)
		}
	})
	hr, err := c.HeartRateGet(t.Context(), HeartRateRequest{AfterDate: "2026-08-01", BeforeDate: "2026-08-04"})
	if err != nil {
		t.Fatal(err)
	}
	if hr.Count != 2 || hr.Entries[0].Date != "2026-08-01" || hr.Entries[0].RestingHR != 52 || hr.Entries[1].RestingHR != 55 {
		t.Fatalf("%#v", hr)
	}
	hrv, err := c.HRVGet(t.Context(), HRVRequest{AfterDate: "2026-08-01", BeforeDate: "2026-08-04"})
	if err != nil {
		t.Fatal(err)
	}
	if hrv.Count != 2 || hrv.Entries[0].RMSSD != 38 || hrv.Entries[1].RMSSD != 40 {
		t.Fatalf("%#v", hrv)
	}
}

func TestActivitiesListAndGet(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "dataPoints:reconcile"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"dataPoints": []map[string]any{
					{
						"name": "users/me/dataTypes/exercise/dataPoints/ex1",
						"exercise": map[string]any{
							"displayName":    "Walk",
							"exerciseType":   "WALKING",
							"activeDuration": "1800s",
							"interval":       map[string]any{"startTime": "2026-08-03T10:00:00Z"},
							"metricsSummary": map[string]any{"caloriesKcal": 120, "steps": "2500", "distanceMillimeters": 2_000_000},
						},
					},
				},
			})
		case strings.Contains(r.URL.Path, "/dataPoints/ex1"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"name": "users/me/dataTypes/exercise/dataPoints/ex1",
				"exercise": map[string]any{
					"displayName":    "Walk",
					"exerciseType":   "WALKING",
					"activeDuration": "1800s",
					"interval":       map[string]any{"startTime": "2026-08-03T10:00:00Z"},
					"metricsSummary": map[string]any{"caloriesKcal": 120},
				},
			})
		default:
			http.NotFound(w, r)
		}
	})
	list, err := c.ActivitiesList(t.Context(), ActivitiesListRequest{
		AfterDate:  "2026-08-01",
		BeforeDate: "2026-08-04",
		Limit:      10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if list.Count != 1 || list.Activities[0].Name != "Walk" {
		t.Fatalf("%#v", list)
	}
	if list.Activities[0].DurationMin != 30 {
		t.Fatalf("duration %v", list.Activities[0].DurationMin)
	}
	got, err := c.ActivitiesGet(t.Context(), "ex1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Walk" {
		t.Fatalf("%#v", got)
	}
}

func TestHeartRateAndHRV(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "daily-resting-heart-rate"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"dataPoints": []map[string]any{{
					"dailyRestingHeartRate": map[string]any{
						"date":           map[string]any{"year": 2026, "month": 8, "day": 3},
						"beatsPerMinute": "54",
					},
				}},
			})
		case strings.Contains(r.URL.Path, "daily-heart-rate-variability"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"dataPoints": []map[string]any{{
					"dailyHeartRateVariability": map[string]any{
						"date": map[string]any{"year": 2026, "month": 8, "day": 3},
						"averageHeartRateVariabilityMilliseconds": 42.5,
					},
				}},
			})
		default:
			http.NotFound(w, r)
		}
	})
	hr, err := c.HeartRateGet(t.Context(), HeartRateRequest{Date: "2026-08-03"})
	if err != nil {
		t.Fatal(err)
	}
	if hr.Count != 1 || hr.Entries[0].RestingHR != 54 {
		t.Fatalf("%#v", hr)
	}
	hrv, err := c.HRVGet(t.Context(), HRVRequest{Date: "2026-08-03"})
	if err != nil {
		t.Fatal(err)
	}
	if hrv.Count != 1 || hrv.Entries[0].RMSSD != 42.5 {
		t.Fatalf("%#v", hrv)
	}
}

func TestWeightAndProfile(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/identity"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"legacyUserId": "FITBIT1",
				"healthUserId": "G123",
			})
		case strings.Contains(r.URL.Path, "dataTypes/weight"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"dataPoints": []map[string]any{{
					"name": "users/me/dataTypes/weight/dataPoints/w1",
					"weight": map[string]any{
						"weightGrams": 82000,
						"sampleTime": map[string]any{
							"physicalTime": "2026-08-03T08:00:00Z",
							"civilTime":    map[string]any{"date": map[string]any{"year": 2026, "month": 8, "day": 3}},
						},
					},
				}},
			})
		default:
			http.NotFound(w, r)
		}
	})
	wres, err := c.WeightGet(t.Context(), WeightRequest{Period: "1m"})
	if err != nil {
		t.Fatal(err)
	}
	if len(wres.Entries) != 1 {
		t.Fatalf("%#v", wres)
	}
	prof, err := c.ProfileGet(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if prof.FitbitUser != "FITBIT1" || prof.GoogleUser != "G123" {
		t.Fatalf("%#v", prof)
	}
}

func TestAPIError(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"nope"}`))
	})
	if _, err := c.SleepGet(t.Context(), SleepGetRequest{Date: "2026-08-03"}); err == nil {
		t.Fatal("expected error")
	}
}

func TestEmptyDailyResults(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"dataPoints": []any{}})
	})
	hr, err := c.HeartRateGet(t.Context(), HeartRateRequest{Date: "2026-08-03"})
	if err != nil {
		t.Fatal(err)
	}
	if hr.Count != 0 || !strings.Contains(hr.Note, "no daily") {
		t.Fatalf("%#v", hr)
	}
	hrv, err := c.HRVGet(t.Context(), HRVRequest{Date: "2026-08-03"})
	if err != nil {
		t.Fatal(err)
	}
	if hrv.Count != 0 || !strings.Contains(hrv.Note, "no daily") {
		t.Fatalf("%#v", hrv)
	}
}

func TestAccountStatusLive(t *testing.T) {
	c2 := &Client{AccessToken: "tok", PreferWearables: true, mu: &sync.Mutex{}}
	st := c2.AccountStatus()
	if st["authenticated"] != true {
		t.Fatalf("%#v", st)
	}
	if st["implementation"] != "live health.googleapis.com/v4 reconcile" {
		t.Fatalf("%#v", st["implementation"])
	}
}
