package garmin

import (
	"encoding/json"
	"testing"
)

func TestFitnessAgeStatsJSONUnmarshal(t *testing.T) {
	rawJSON := `[
		{
			"calendarDate": "2026-01-15",
			"values": {
				"achievableFitnessAge": 28.5,
				"vigorousDaysAvg": 3.2,
				"fitnessAge": 32.1,
				"rhr": 48,
				"bmi": 22.4
			}
		}
	]`

	var stats FitnessAgeStats
	if err := json.Unmarshal([]byte(rawJSON), &stats); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if len(stats.Entries) != 1 {
		t.Fatalf("Entries len = %d, want 1", len(stats.Entries))
	}
	e := stats.Entries[0]
	if e.CalendarDate != "2026-01-15" {
		t.Errorf("CalendarDate = %s", e.CalendarDate)
	}
	if e.Values.FitnessAge != 32.1 {
		t.Errorf("FitnessAge = %v, want 32.1", e.Values.FitnessAge)
	}
	if e.Values.RHR != 48 {
		t.Errorf("RHR = %d, want 48", e.Values.RHR)
	}
}

func TestFitnessAgeStatsRawJSONSetRaw(t *testing.T) {
	raw := json.RawMessage(`[{"calendarDate":"2026-01-15"}]`)
	var stats FitnessAgeStats
	stats.SetRaw(raw)
	if string(stats.RawJSON()) != string(raw) {
		t.Error("RawJSON/SetRaw mismatch")
	}
}
