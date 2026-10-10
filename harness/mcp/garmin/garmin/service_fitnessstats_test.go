package garmin

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestFitnessStatsJSONUnmarshal(t *testing.T) {
	rawJSON := `[
		{
			"date": "2026-01-01",
			"countOfActivities": 3,
			"stats": {
				"all": {
					"distance": {"count": 3, "min": 1000, "max": 5000, "avg": 3000, "sum": 9000},
					"calories": {"count": 3, "min": 200, "max": 600, "avg": 400, "sum": 1200}
				}
			}
		}
	]`

	var stats FitnessStats
	if err := json.Unmarshal([]byte(rawJSON), &stats); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if len(stats.Entries) != 1 {
		t.Fatalf("Entries len = %d, want 1", len(stats.Entries))
	}
	e := stats.Entries[0]
	if e.Date != "2026-01-01" || e.CountOfActivities != 3 {
		t.Errorf("entry = %+v", e)
	}
	dist := e.Stats["all"]["distance"]
	if dist.Sum != 9000 {
		t.Errorf("distance.sum = %v, want 9000", dist.Sum)
	}
}

func TestFitnessStatsActivitiesJSONUnmarshal(t *testing.T) {
	rawJSON := `[{"activityId":123,"name":"Morning Run","activityType":"running","distance":5000}]`

	var acts FitnessStatsActivities
	if err := json.Unmarshal([]byte(rawJSON), &acts); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if len(acts.Activities) != 1 {
		t.Fatalf("Activities len = %d, want 1", len(acts.Activities))
	}
	if acts.Activities[0].ActivityID != 123 || acts.Activities[0].Name != "Morning Run" {
		t.Errorf("activity = %+v", acts.Activities[0])
	}
}

func TestFitnessStatsRawJSONSetRaw(t *testing.T) {
	raw := json.RawMessage(`[{"date":"2026-01-01"}]`)
	var stats FitnessStats
	stats.SetRaw(raw)
	if string(stats.RawJSON()) != string(raw) {
		t.Error("FitnessStats RawJSON/SetRaw mismatch")
	}

	var acts FitnessStatsActivities
	acts.SetRaw(raw)
	if string(acts.RawJSON()) != string(raw) {
		t.Error("FitnessStatsActivities RawJSON/SetRaw mismatch")
	}
}

func TestFitnessStatsOptions_buildQuery(t *testing.T) {
	minDist := 1000.0
	opts := &FitnessStatsOptions{
		Aggregation:         AggregationWeekly,
		StartDate:           time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		EndDate:             time.Date(2026, 1, 31, 0, 0, 0, 0, time.UTC),
		Metrics:             []FitnessMetric{MetricCalories, MetricDistance},
		GroupByActivityType: true,
		MinimumDistance:     &minDist,
	}
	q := opts.buildQuery()
	for _, want := range []string{
		"aggregation=weekly",
		"startDate=2026-01-01",
		"endDate=2026-01-31",
		"userFirstDay=monday",
		"groupByActivityType=true",
		"metric=calories",
		"metric=distance",
		"minimumDistance=",
	} {
		if !strings.Contains(q, want) {
			t.Errorf("buildQuery missing %q in %q", want, q)
		}
	}
}

func TestFitnessStatsOptions_buildQueryAll(t *testing.T) {
	opts := &FitnessStatsOptions{
		StartDate:    time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		EndDate:      time.Date(2026, 1, 7, 0, 0, 0, 0, time.UTC),
		Metrics:      []FitnessMetric{MetricName, MetricDuration},
		ActivityType: "running",
	}
	q := opts.buildQueryAll()
	for _, want := range []string{
		"startDate=2026-01-01",
		"endDate=2026-01-07",
		"activityType=running",
		"metric=name",
		"metric=duration",
	} {
		if !strings.Contains(q, want) {
			t.Errorf("buildQueryAll missing %q in %q", want, q)
		}
	}
}

func TestFitnessStatsService_validation(t *testing.T) {
	s := &FitnessStatsService{client: New(Options{})}
	ctx := context.Background()

	if _, err := s.GetActivityStats(ctx, nil); err == nil {
		t.Error("GetActivityStats(nil) should error")
	}
	if _, err := s.GetActivityStats(ctx, &FitnessStatsOptions{}); err == nil {
		t.Error("GetActivityStats with empty metrics should error")
	}
	if _, err := s.GetAllActivities(ctx, nil); err == nil {
		t.Error("GetAllActivities(nil) should error")
	}
	if _, err := s.GetAllActivities(ctx, &FitnessStatsOptions{}); err == nil {
		t.Error("GetAllActivities with empty metrics should error")
	}
}
