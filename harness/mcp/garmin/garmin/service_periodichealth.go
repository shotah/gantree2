package garmin

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// MenstrualDaySummary summarizes cycle position for a day.
type MenstrualDaySummary struct {
	StartDate             string  `json:"startDate"`
	DayInCycle            int     `json:"dayInCycle"`
	PeriodLength          *int    `json:"periodLength"`
	CurrentPhase          *int    `json:"currentPhase"`
	LengthOfCurrentPhase  *int    `json:"lengthOfCurrentPhase"`
	DaysUntilNextPhase    *int    `json:"daysUntilNextPhase"`
	FertileWindowStart    *int    `json:"fertileWindowStart"`
	LengthOfFertileWindow *int    `json:"lengthOfFertileWindow"`
	PredictedCycleLength  *int    `json:"predictedCycleLength"`
	CycleType             string  `json:"cycleType"`
	PredictedCycle        bool    `json:"predictedCycle"`
	PregnancyCycle        bool    `json:"pregnancyCycle"`
	NumberOfWeek          *int    `json:"numberOfWeek"`
	DueDate               *string `json:"dueDate"`
}

// MenstrualDayLog is logged symptoms/moods for a day.
type MenstrualDayLog struct {
	UserProfilePK   int64    `json:"userProfilePk"`
	CalendarDate    string   `json:"calendarDate"`
	Symptoms        []string `json:"symptoms"`
	Moods           []string `json:"moods"`
	Discharge       []string `json:"discharge"`
	Flow            *string  `json:"flow"`
	SexDrive        *string  `json:"sexDrive"`
	SexualActivity  *string  `json:"sexualActivity"`
	Notes           *string  `json:"notes"`
	OvulationDay    bool     `json:"ovulationDay"`
	HasGlucoseLog   bool     `json:"hasGlucoseLog"`
	HasBabyMovement bool     `json:"hasBabyMovement"`
}

// MenstrualDayView is the dayview response.
type MenstrualDayView struct {
	DaySummary *MenstrualDaySummary `json:"daySummary"`
	DayLog     *MenstrualDayLog     `json:"dayLog"`
	raw        json.RawMessage
}

func (m *MenstrualDayView) RawJSON() json.RawMessage { return m.raw }

func (m *MenstrualDayView) SetRaw(data json.RawMessage) { m.raw = data }

// MenstrualCycleSummary is one cycle in the calendar view.
type MenstrualCycleSummary struct {
	StartDate      string  `json:"startDate"`
	PregnancyCycle bool    `json:"pregnancyCycle"`
	DueDate        *string `json:"dueDate"`
	PredictedCycle bool    `json:"predictedCycle"`
}

// MenstrualCalendar is the calendar range response.
type MenstrualCalendar struct {
	CycleSummaries      []MenstrualCycleSummary `json:"cycleSummaries"`
	LoggedSymptomDays   []string                `json:"loggedSymptomDays"`
	LoggedOvulationDays []string                `json:"loggedOvulationDays"`
	LoggedNoteDays      []string                `json:"loggedNoteDays"`
	raw                 json.RawMessage
}

func (m *MenstrualCalendar) RawJSON() json.RawMessage { return m.raw }

func (m *MenstrualCalendar) SetRaw(data json.RawMessage) { m.raw = data }

// PregnancySnapshot is the pregnancy summary payload.
type PregnancySnapshot struct {
	raw json.RawMessage
}

func (p *PregnancySnapshot) RawJSON() json.RawMessage { return p.raw }

func (p *PregnancySnapshot) SetRaw(data json.RawMessage) { p.raw = data }

func (p *PregnancySnapshot) UnmarshalJSON(data []byte) error {
	p.raw = append(json.RawMessage(nil), data...)
	return nil
}

// GetMenstrualDayView retrieves menstrual/pregnancy day view for a date.
func (s *PeriodicHealthService) GetMenstrualDayView(ctx context.Context, date time.Time) (*MenstrualDayView, error) {
	path := "/periodichealth-service/menstrualcycle/dayview/" + date.Format("2006-01-02")
	return fetch[MenstrualDayView](ctx, s.client, path)
}

// GetMenstrualCalendar retrieves menstrual calendar data for a date range.
func (s *PeriodicHealthService) GetMenstrualCalendar(ctx context.Context, start, end time.Time) (*MenstrualCalendar, error) {
	path := fmt.Sprintf(
		"/periodichealth-service/menstrualcycle/calendar/%s/%s",
		start.Format("2006-01-02"),
		end.Format("2006-01-02"),
	)
	return fetch[MenstrualCalendar](ctx, s.client, path)
}

// GetPregnancySnapshot retrieves the pregnancy snapshot summary.
func (s *PeriodicHealthService) GetPregnancySnapshot(ctx context.Context) (*PregnancySnapshot, error) {
	return fetch[PregnancySnapshot](ctx, s.client, "/periodichealth-service/menstrualcycle/pregnancysnapshot")
}
