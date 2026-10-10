package garmin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

const maxStepsDailyRangeDays = 28

// DailyUserSummary is the Connect home-screen daily totals payload.
type DailyUserSummary struct {
	UserProfileID                    int64    `json:"userProfileId"`
	UserDailySummaryID               int64    `json:"userDailySummaryId"`
	CalendarDate                     string   `json:"calendarDate"`
	UUID                             string   `json:"uuid"`
	TotalKilocalories                float64  `json:"totalKilocalories"`
	ActiveKilocalories               float64  `json:"activeKilocalories"`
	BMRKilocalories                  float64  `json:"bmrKilocalories"`
	WellnessKilocalories             float64  `json:"wellnessKilocalories"`
	BurnedKilocalories               *float64 `json:"burnedKilocalories"`
	ConsumedKilocalories             *float64 `json:"consumedKilocalories"`
	RemainingKilocalories            float64  `json:"remainingKilocalories"`
	NetCalorieGoal                   *float64 `json:"netCalorieGoal"`
	TotalSteps                       int      `json:"totalSteps"`
	DailyStepGoal                    int      `json:"dailyStepGoal"`
	TotalDistanceMeters              float64  `json:"totalDistanceMeters"`
	WellnessDistanceMeters           float64  `json:"wellnessDistanceMeters"`
	WellnessActiveKilocalories       float64  `json:"wellnessActiveKilocalories"`
	NetRemainingKilocalories         float64  `json:"netRemainingKilocalories"`
	HighlyActiveSeconds              int      `json:"highlyActiveSeconds"`
	ActiveSeconds                    int      `json:"activeSeconds"`
	SedentarySeconds                 int      `json:"sedentarySeconds"`
	SleepingSeconds                  int      `json:"sleepingSeconds"`
	FloorsAscended                   float64  `json:"floorsAscended"`
	FloorsDescended                  float64  `json:"floorsDescended"`
	FloorsAscendedInMeters           float64  `json:"floorsAscendedInMeters"`
	FloorsDescendedInMeters          float64  `json:"floorsDescendedInMeters"`
	UserFloorsAscendedGoal           int      `json:"userFloorsAscendedGoal"`
	IntensityMinutesGoal             int      `json:"intensityMinutesGoal"`
	ModerateIntensityMinutes         *int     `json:"moderateIntensityMinutes"`
	VigorousIntensityMinutes         *int     `json:"vigorousIntensityMinutes"`
	MinHeartRate                     int      `json:"minHeartRate"`
	MaxHeartRate                     int      `json:"maxHeartRate"`
	RestingHeartRate                 *int     `json:"restingHeartRate"`
	LastSevenDaysAvgRestingHeartRate *int     `json:"lastSevenDaysAvgRestingHeartRate"`
	AverageStressLevel               int      `json:"averageStressLevel"`
	MaxStressLevel                   int      `json:"maxStressLevel"`
	StressQualifier                  string   `json:"stressQualifier"`
	BodyBatteryChargedValue          int      `json:"bodyBatteryChargedValue"`
	BodyBatteryDrainedValue          int      `json:"bodyBatteryDrainedValue"`
	BodyBatteryHighestValue          int      `json:"bodyBatteryHighestValue"`
	BodyBatteryLowestValue           int      `json:"bodyBatteryLowestValue"`
	BodyBatteryMostRecentValue       int      `json:"bodyBatteryMostRecentValue"`
	IncludesWellnessData             bool     `json:"includesWellnessData"`
	IncludesActivityData             bool     `json:"includesActivityData"`
	PrivacyProtected                 bool     `json:"privacyProtected"`

	raw json.RawMessage
}

// RawJSON returns the original JSON response.
func (d *DailyUserSummary) RawJSON() json.RawMessage { return d.raw }

// SetRaw sets the raw JSON response.
func (d *DailyUserSummary) SetRaw(data json.RawMessage) { d.raw = data }

// DailyHydration is hydration intake for a single day.
type DailyHydration struct {
	UserProfileID           *int64   `json:"userProfileId"`
	CalendarDate            string   `json:"calendarDate"`
	ValueInML               float64  `json:"valueInML"`
	GoalInML                *float64 `json:"goalInML"`
	DailyAverageInML        *float64 `json:"dailyAverageInML"`
	LastEntryTimestampLocal *string  `json:"lastEntryTimestampLocal"`

	raw json.RawMessage
}

// RawJSON returns the original JSON response.
func (d *DailyHydration) RawJSON() json.RawMessage { return d.raw }

// SetRaw sets the raw JSON response.
func (d *DailyHydration) SetRaw(data json.RawMessage) { d.raw = data }

// HydrationLogRequest is the body for logging hydration intake.
type HydrationLogRequest struct {
	CalendarDate   string  `json:"calendarDate"`
	TimestampLocal string  `json:"timestampLocal"`
	ValueInML      float64 `json:"valueInML"`
}

// StepsDailyStat is one day of steps stats.
type StepsDailyStat struct {
	CalendarDate  string  `json:"calendarDate"`
	TotalSteps    int     `json:"totalSteps"`
	StepGoal      int     `json:"stepGoal"`
	TotalDistance float64 `json:"totalDistance"`
}

// StepsDailyStats is a list of daily steps stats.
type StepsDailyStats struct {
	Entries []StepsDailyStat
	raw     json.RawMessage
}

func (s *StepsDailyStats) RawJSON() json.RawMessage { return s.raw }

func (s *StepsDailyStats) SetRaw(data json.RawMessage) { s.raw = data }

func (s *StepsDailyStats) UnmarshalJSON(data []byte) error {
	return json.Unmarshal(data, &s.Entries)
}

// StepsWeeklyStat is one week of aggregated steps.
type StepsWeeklyStat struct {
	CalendarDate          string  `json:"calendarDate"`
	TotalSteps            int     `json:"totalSteps"`
	AverageSteps          float64 `json:"averageSteps"`
	TotalDistance         float64 `json:"totalDistance"`
	AverageDistance       float64 `json:"averageDistance"`
	WellnessDataDaysCount int     `json:"wellnessDataDaysCount"`
}

// StepsWeeklyStats is a list of weekly steps aggregates.
type StepsWeeklyStats struct {
	Entries []StepsWeeklyStat
	raw     json.RawMessage
}

func (s *StepsWeeklyStats) RawJSON() json.RawMessage { return s.raw }

func (s *StepsWeeklyStats) SetRaw(data json.RawMessage) { s.raw = data }

func (s *StepsWeeklyStats) UnmarshalJSON(data []byte) error {
	return json.Unmarshal(data, &s.Entries)
}

// StressDailyStat is one day of stress stats.
type StressDailyStat struct {
	CalendarDate string `json:"calendarDate"`
	Value        int    `json:"value"`
}

// StressDailyStats is a list of daily stress stats.
type StressDailyStats struct {
	Entries []StressDailyStat
	raw     json.RawMessage
}

func (s *StressDailyStats) RawJSON() json.RawMessage { return s.raw }

func (s *StressDailyStats) SetRaw(data json.RawMessage) { s.raw = data }

func (s *StressDailyStats) UnmarshalJSON(data []byte) error {
	return json.Unmarshal(data, &s.Entries)
}

// StressWeeklyStat is one week of stress aggregates.
type StressWeeklyStat struct {
	CalendarDate string `json:"calendarDate"`
	Value        int    `json:"value"`
}

// StressWeeklyStats is a list of weekly stress aggregates.
type StressWeeklyStats struct {
	Entries []StressWeeklyStat
	raw     json.RawMessage
}

func (s *StressWeeklyStats) RawJSON() json.RawMessage { return s.raw }

func (s *StressWeeklyStats) SetRaw(data json.RawMessage) { s.raw = data }

func (s *StressWeeklyStats) UnmarshalJSON(data []byte) error {
	return json.Unmarshal(data, &s.Entries)
}

// HydrationDailyStat is one day of hydration stats.
type HydrationDailyStat struct {
	CalendarDate string   `json:"calendarDate"`
	ValueInML    float64  `json:"valueInML"`
	GoalInML     *float64 `json:"goalInML"`
}

// HydrationDailyStats is a list of daily hydration stats.
type HydrationDailyStats struct {
	Entries []HydrationDailyStat
	raw     json.RawMessage
}

func (h *HydrationDailyStats) RawJSON() json.RawMessage { return h.raw }

func (h *HydrationDailyStats) SetRaw(data json.RawMessage) { h.raw = data }

func (h *HydrationDailyStats) UnmarshalJSON(data []byte) error {
	return json.Unmarshal(data, &h.Entries)
}

// IntensityMinutesDailyStat is one day of intensity-minutes stats.
type IntensityMinutesDailyStat struct {
	CalendarDate  string `json:"calendarDate"`
	WeeklyGoal    int    `json:"weeklyGoal"`
	ModerateValue int    `json:"moderateValue"`
	VigorousValue int    `json:"vigorousValue"`
}

// IntensityMinutesDailyStats is a list of daily intensity-minutes stats.
type IntensityMinutesDailyStats struct {
	Entries []IntensityMinutesDailyStat
	raw     json.RawMessage
}

func (i *IntensityMinutesDailyStats) RawJSON() json.RawMessage { return i.raw }

func (i *IntensityMinutesDailyStats) SetRaw(data json.RawMessage) { i.raw = data }

func (i *IntensityMinutesDailyStats) UnmarshalJSON(data []byte) error {
	return json.Unmarshal(data, &i.Entries)
}

// IntensityMinutesWeeklyStat is one week of intensity-minutes aggregates.
type IntensityMinutesWeeklyStat struct {
	CalendarDate  string `json:"calendarDate"`
	WeeklyGoal    int    `json:"weeklyGoal"`
	ModerateValue int    `json:"moderateValue"`
	VigorousValue int    `json:"vigorousValue"`
}

// IntensityMinutesWeeklyStats is a list of weekly intensity-minutes aggregates.
type IntensityMinutesWeeklyStats struct {
	Entries []IntensityMinutesWeeklyStat
	raw     json.RawMessage
}

func (i *IntensityMinutesWeeklyStats) RawJSON() json.RawMessage { return i.raw }

func (i *IntensityMinutesWeeklyStats) SetRaw(data json.RawMessage) { i.raw = data }

func (i *IntensityMinutesWeeklyStats) UnmarshalJSON(data []byte) error {
	return json.Unmarshal(data, &i.Entries)
}

// GetDaily retrieves the daily user summary (Connect home-screen totals).
func (s *UserSummaryService) GetDaily(ctx context.Context, displayName string, date time.Time) (*DailyUserSummary, error) {
	path := fmt.Sprintf(
		"/usersummary-service/usersummary/daily/%s?calendarDate=%s",
		displayName,
		date.Format("2006-01-02"),
	)
	return fetch[DailyUserSummary](ctx, s.client, path)
}

// GetHydration retrieves hydration data for a single day.
func (s *UserSummaryService) GetHydration(ctx context.Context, date time.Time) (*DailyHydration, error) {
	path := "/usersummary-service/usersummary/hydration/daily/" + date.Format("2006-01-02")
	return fetch[DailyHydration](ctx, s.client, path)
}

// LogHydration logs (or adjusts) hydration intake. Positive adds ml; negative subtracts.
// The live Connect API expects PUT.
func (s *UserSummaryService) LogHydration(ctx context.Context, req *HydrationLogRequest) (*DailyHydration, error) {
	if req == nil {
		return nil, errors.New("hydration log request is required")
	}
	return send[DailyHydration](
		ctx,
		s.client,
		http.MethodPut,
		"/usersummary-service/usersummary/hydration/log",
		req,
	)
}

// GetStepsDaily retrieves daily steps stats for a date range (max 28 days per API call;
// longer ranges are automatically chunked).
func (s *UserSummaryService) GetStepsDaily(ctx context.Context, start, end time.Time) (*StepsDailyStats, error) {
	start = dateOnly(start)
	end = dateOnly(end)
	if end.Before(start) {
		return nil, errors.New("end date cannot be before start date")
	}

	days := int(end.Sub(start).Hours()/24) + 1
	if days <= maxStepsDailyRangeDays {
		path := fmt.Sprintf(
			"/usersummary-service/stats/steps/daily/%s/%s",
			start.Format("2006-01-02"),
			end.Format("2006-01-02"),
		)
		return fetch[StepsDailyStats](ctx, s.client, path)
	}

	var all []StepsDailyStat
	for chunkStart := start; !chunkStart.After(end); {
		chunkEnd := chunkStart.AddDate(0, 0, maxStepsDailyRangeDays-1)
		if chunkEnd.After(end) {
			chunkEnd = end
		}
		path := fmt.Sprintf(
			"/usersummary-service/stats/steps/daily/%s/%s",
			chunkStart.Format("2006-01-02"),
			chunkEnd.Format("2006-01-02"),
		)
		chunk, err := fetch[StepsDailyStats](ctx, s.client, path)
		if err != nil {
			return nil, err
		}
		all = append(all, chunk.Entries...)
		chunkStart = chunkEnd.AddDate(0, 0, 1)
	}

	mergedRaw, _ := json.Marshal(all)
	return &StepsDailyStats{Entries: all, raw: mergedRaw}, nil
}

// GetStepsWeekly retrieves weekly steps aggregates ending on end for the given week count.
func (s *UserSummaryService) GetStepsWeekly(ctx context.Context, end time.Time, weeks int) (*StepsWeeklyStats, error) {
	if weeks < 1 {
		return nil, errors.New("weeks must be >= 1")
	}
	path := fmt.Sprintf(
		"/usersummary-service/stats/steps/weekly/%s/%d",
		end.Format("2006-01-02"),
		weeks,
	)
	return fetch[StepsWeeklyStats](ctx, s.client, path)
}

// GetStressDaily retrieves daily stress stats for a date range.
func (s *UserSummaryService) GetStressDaily(ctx context.Context, start, end time.Time) (*StressDailyStats, error) {
	path := fmt.Sprintf(
		"/usersummary-service/stats/stress/daily/%s/%s",
		start.Format("2006-01-02"),
		end.Format("2006-01-02"),
	)
	return fetch[StressDailyStats](ctx, s.client, path)
}

// GetStressWeekly retrieves weekly stress aggregates ending on end for the given week count.
func (s *UserSummaryService) GetStressWeekly(ctx context.Context, end time.Time, weeks int) (*StressWeeklyStats, error) {
	if weeks < 1 {
		return nil, errors.New("weeks must be >= 1")
	}
	path := fmt.Sprintf(
		"/usersummary-service/stats/stress/weekly/%s/%d",
		end.Format("2006-01-02"),
		weeks,
	)
	return fetch[StressWeeklyStats](ctx, s.client, path)
}

// GetHydrationStats retrieves daily hydration stats for a date range.
func (s *UserSummaryService) GetHydrationStats(ctx context.Context, start, end time.Time) (*HydrationDailyStats, error) {
	path := fmt.Sprintf(
		"/usersummary-service/stats/hydration/daily/%s/%s",
		start.Format("2006-01-02"),
		end.Format("2006-01-02"),
	)
	return fetch[HydrationDailyStats](ctx, s.client, path)
}

// GetIntensityMinutesDaily retrieves daily intensity-minutes stats for a date range.
func (s *UserSummaryService) GetIntensityMinutesDaily(ctx context.Context, start, end time.Time) (*IntensityMinutesDailyStats, error) {
	path := fmt.Sprintf(
		"/usersummary-service/stats/im/daily/%s/%s",
		start.Format("2006-01-02"),
		end.Format("2006-01-02"),
	)
	return fetch[IntensityMinutesDailyStats](ctx, s.client, path)
}

// GetIntensityMinutesWeekly retrieves weekly intensity-minutes aggregates for a date range.
func (s *UserSummaryService) GetIntensityMinutesWeekly(ctx context.Context, start, end time.Time) (*IntensityMinutesWeeklyStats, error) {
	path := fmt.Sprintf(
		"/usersummary-service/stats/im/weekly/%s/%s",
		start.Format("2006-01-02"),
		end.Format("2006-01-02"),
	)
	return fetch[IntensityMinutesWeeklyStats](ctx, s.client, path)
}

func dateOnly(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}
