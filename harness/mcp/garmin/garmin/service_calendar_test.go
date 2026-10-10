package garmin

import (
	"context"
	"encoding/json"
	"testing"
)

func TestCalendarJSONUnmarshal(t *testing.T) {
	rawJSON := `{
		"startDate": "2026-01-01",
		"endDate": "2026-01-31",
		"numOfDaysInMonth": 31,
		"calendarItems": [
			{
				"id": 1,
				"itemType": "activity",
				"date": "2026-01-15",
				"title": "Morning Run",
				"distance": 5000,
				"calories": 400
			},
			{
				"id": 2,
				"itemType": "weight",
				"date": "2026-01-16",
				"weight": 70.5
			}
		]
	}`

	var cal Calendar
	if err := json.Unmarshal([]byte(rawJSON), &cal); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if cal.StartDate != "2026-01-01" || cal.NumOfDaysInMonth != 31 {
		t.Errorf("calendar header = %+v", cal)
	}
	if len(cal.CalendarItems) != 2 {
		t.Fatalf("items = %d, want 2", len(cal.CalendarItems))
	}
	if cal.CalendarItems[0].ItemType != "activity" {
		t.Errorf("item0 type = %s", cal.CalendarItems[0].ItemType)
	}
	if cal.CalendarItems[1].Weight == nil || *cal.CalendarItems[1].Weight != 70.5 {
		t.Errorf("item1 weight = %v", cal.CalendarItems[1].Weight)
	}
}

func TestCalendarRawJSONSetRaw(t *testing.T) {
	raw := json.RawMessage(`{"startDate":"2026-01-01"}`)
	var cal Calendar
	cal.SetRaw(raw)
	if string(cal.RawJSON()) != string(raw) {
		t.Error("RawJSON/SetRaw mismatch")
	}
}

func TestCalendarService_Get_dayRequiresStart(t *testing.T) {
	s := &CalendarService{client: New(Options{})}
	month := 0
	day := 15
	_, err := s.Get(context.Background(), 2026, &CalendarOptions{
		Month: &month,
		Day:   &day,
	})
	if err == nil {
		t.Fatal("expected error when day is set without start")
	}
}
