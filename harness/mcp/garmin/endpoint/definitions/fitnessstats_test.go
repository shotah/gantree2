package definitions

import (
	"testing"

	"github.com/shotah/go-garmin/garmin"
)

func TestParseMetrics(t *testing.T) {
	got, err := parseMetrics("calories, distance, duration")
	if err != nil {
		t.Fatalf("parseMetrics: %v", err)
	}
	want := []garmin.FitnessMetric{
		garmin.MetricCalories,
		garmin.MetricDistance,
		garmin.MetricDuration,
	}
	if len(got) != len(want) {
		t.Fatalf("len = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("got[%d] = %s, want %s", i, got[i], want[i])
		}
	}

	if _, err := parseMetrics("calories,notAMetric"); err == nil {
		t.Fatal("expected error for unknown metric")
	}

	all := "calories,distance,duration,avgSpeed,maxHr,avgHr,elevationGain,avgRunCadence,avgGroundContactBalance,avgStrideLength,avgVerticalOscillation,avgVerticalRatio,avgGroundContactTime,startLocal,activityType,activitySubType,name,aerobicTrainingEffect,anaerobicTrainingEffect"
	got, err = parseMetrics(all)
	if err != nil {
		t.Fatalf("parse all metrics: %v", err)
	}
	if len(got) != 19 {
		t.Fatalf("got %d metrics, want 19", len(got))
	}
}
