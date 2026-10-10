package ghealth

import (
	"strings"
	"testing"
	"time"
)

func TestFilterDaySession(t *testing.T) {
	now := time.Date(2026, 8, 3, 15, 0, 0, 0, time.Local)
	f, day, err := filterDaySession("sleep", "2026-08-03", now)
	if err != nil {
		t.Fatal(err)
	}
	if day.String() != "2026-08-03" {
		t.Fatalf("day %s", day)
	}
	if !strings.Contains(f, `civil_end_time >= "2026-08-03"`) {
		t.Fatalf("filter %q", f)
	}
	if !strings.Contains(f, `civil_end_time < "2026-08-04"`) {
		t.Fatalf("filter %q", f)
	}
}

func TestFilterDaySessionDefaultToday(t *testing.T) {
	now := time.Date(2026, 8, 3, 15, 0, 0, 0, time.Local)
	_, day, err := filterDaySession("sleep", "", now)
	if err != nil {
		t.Fatal(err)
	}
	if day.String() != "2026-08-03" {
		t.Fatalf("day %s", day)
	}
}

func TestFilterSessionRangeDefault(t *testing.T) {
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.Local)
	f, err := filterSessionRange("exercise", "", "", now)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(f, "civil_start_time") {
		t.Fatalf("%q", f)
	}
}

func TestFilterDailyDate(t *testing.T) {
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.Local)
	f, day, err := filterDailyDate("daily_resting_heart_rate", "2026-08-01", now)
	if err != nil {
		t.Fatal(err)
	}
	if day.String() != "2026-08-01" {
		t.Fatal(day)
	}
	if !strings.Contains(f, "date(2026, 8, 1)") {
		t.Fatalf("%q", f)
	}
}

func TestFilterSleepWindowRange(t *testing.T) {
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.Local)
	f, err := filterSleepWindow("", "2026-08-01", "2026-08-08", now)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(f, `civil_end_time >= "2026-08-01"`) || !strings.Contains(f, `civil_end_time < "2026-08-08"`) {
		t.Fatalf("%q", f)
	}
	if _, err := filterSleepWindow("", "2026-08-08", "2026-08-01", now); err == nil {
		t.Fatal("expected inverted range error")
	}
}

func TestFilterDailyWindowRange(t *testing.T) {
	now := time.Date(2026, 8, 10, 12, 0, 0, 0, time.Local)
	f, err := filterDailyWindow("daily_resting_heart_rate", "", "2026-08-01", "2026-08-08", now)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(f, "date(2026, 8, 1)") || !strings.Contains(f, "date(2026, 8, 8)") {
		t.Fatalf("%q", f)
	}
	one, err := filterDailyWindow("daily_heart_rate_variability", "2026-08-03", "", "", now)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(one, "date = date(2026, 8, 3)") {
		t.Fatalf("%q", one)
	}
}

func TestFilterWeightPeriod(t *testing.T) {
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.Local)
	f, err := filterWeightPeriod("2026-08-03", "1m", now)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(f, "weight.sample_time.civil_time.date") {
		t.Fatalf("%q", f)
	}
	if _, err := filterWeightPeriod("", "nope", now); err == nil {
		t.Fatal("expected error")
	}
}

func TestParseDurationSeconds(t *testing.T) {
	if parseDurationSeconds("3600s") != 3600 {
		t.Fatal(parseDurationSeconds("3600s"))
	}
	if parseDurationSeconds("3.5s") != 3.5 {
		t.Fatal(parseDurationSeconds("3.5s"))
	}
}

func TestCivilAddDays(t *testing.T) {
	d := CivilDate{Year: 2026, Month: 8, Day: 31}
	if d.AddDays(1).String() != "2026-09-01" {
		t.Fatal(d.AddDays(1))
	}
}
