package ghealth

// SleepGetRequest is a wake-up-day sleep query.
// Date alone is one civil day (empty = today / last night).
// AfterDate (inclusive) and BeforeDate (exclusive) fetch the span in one call;
// when either is set, Date is ignored.
type SleepGetRequest struct {
	Date       string
	AfterDate  string
	BeforeDate string
}

// SleepResult is one sleep session (main night or nap).
// SleepScore is set only when the payload actually carries one. The Google
// Health app's 0–100 Sleep Score is not a field on dataTypes/sleep.
type SleepResult struct {
	Date                 string             `json:"date,omitempty"`
	Main                 bool               `json:"main"`
	Nap                  bool               `json:"nap,omitempty"`
	DurationMinutes      float64            `json:"duration_minutes,omitempty"`
	Efficiency           float64            `json:"efficiency,omitempty"`
	MinutesAwake         float64            `json:"minutes_awake,omitempty"`
	MinutesInSleepPeriod float64            `json:"minutes_in_sleep_period,omitempty"`
	MinutesToFallAsleep  float64            `json:"minutes_to_fall_asleep,omitempty"`
	MinutesAfterWakeup   float64            `json:"minutes_after_wakeup,omitempty"`
	StagesMinutes        map[string]float64 `json:"stages_minutes,omitempty"`
	SleepScore           *float64           `json:"sleep_score,omitempty"`
	StartTime            string             `json:"start_time,omitempty"`
	EndTime              string             `json:"end_time,omitempty"`
	DataPointName        string             `json:"data_point_name,omitempty"`
	Raw                  map[string]any     `json:"raw,omitempty"`
	Note                 string             `json:"note,omitempty"`
}

// SleepListResult is every session in the requested window.
type SleepListResult struct {
	Sessions []SleepResult `json:"sessions"`
	Count    int           `json:"count"`
	Note     string        `json:"note,omitempty"`
}

// ActivitiesListRequest bounds a day or range.
type ActivitiesListRequest struct {
	AfterDate  string
	BeforeDate string
	Limit      int
	PageToken  string
}

// Activity is a lean exercise summary from dataTypes/exercise.
type Activity struct {
	ID           string  `json:"id"` // resource name or short id
	Name         string  `json:"name,omitempty"`
	ActivityType string  `json:"activity_type,omitempty"`
	StartTime    string  `json:"start_time,omitempty"`
	DurationMin  float64 `json:"duration_minutes,omitempty"`
	Calories     float64 `json:"calories,omitempty"`
	Steps        float64 `json:"steps,omitempty"`
	DistanceKM   float64 `json:"distance_km,omitempty"`
}

// ActivitiesListResult is returned by activities_list.
type ActivitiesListResult struct {
	Activities    []Activity `json:"activities"`
	Count         int        `json:"count"`
	NextPageToken string     `json:"next_page_token,omitempty"`
	Note          string     `json:"note,omitempty"`
}

// HeartRateRequest is a resting-HR query.
// Date alone is one civil day (empty = today). AfterDate / BeforeDate fetch
// the span in one call; when either is set, Date is ignored.
type HeartRateRequest struct {
	Date       string
	AfterDate  string
	BeforeDate string
}

// HeartRateResult is one day's resting heart rate.
type HeartRateResult struct {
	Date      string         `json:"date,omitempty"`
	RestingHR float64        `json:"resting_hr,omitempty"`
	Zones     map[string]any `json:"zones,omitempty"`
	Note      string         `json:"note,omitempty"`
}

// HeartRateListResult is resting HR for each day in the window.
type HeartRateListResult struct {
	Entries []HeartRateResult `json:"entries"`
	Count   int               `json:"count"`
	Note    string            `json:"note,omitempty"`
}

// HRVRequest is a daily HRV query.
// Date alone is one civil day (empty = today). AfterDate / BeforeDate fetch
// the span in one call; when either is set, Date is ignored.
type HRVRequest struct {
	Date       string
	AfterDate  string
	BeforeDate string
}

// HRVResult is one day's heart-rate variability.
type HRVResult struct {
	Date  string         `json:"date,omitempty"`
	RMSSD float64        `json:"rmssd,omitempty"`
	Raw   map[string]any `json:"raw,omitempty"`
	Note  string         `json:"note,omitempty"`
}

// HRVListResult is HRV for each day in the window.
type HRVListResult struct {
	Entries []HRVResult `json:"entries"`
	Count   int         `json:"count"`
	Note    string      `json:"note,omitempty"`
}

// WeightRequest is a body weight log query.
type WeightRequest struct {
	BaseDate string
	Period   string // e.g. 1m, 3m — mapped to civil-time filter when wired
}

// WeightResult is a lean weight series.
type WeightResult struct {
	Entries []map[string]any `json:"entries,omitempty"`
	Note    string           `json:"note,omitempty"`
}

// Profile is lean user identity from getIdentity / profile.
type Profile struct {
	DisplayName string `json:"display_name,omitempty"`
	Timezone    string `json:"timezone,omitempty"`
	FitbitUser  string `json:"fitbit_user_id,omitempty"`
	GoogleUser  string `json:"google_user_id,omitempty"`
	Note        string `json:"note,omitempty"`
}

// Google Health data type path segments (users/me/dataTypes/{type}).
const (
	DataTypeSleep                     = "sleep"
	DataTypeExercise                  = "exercise"
	DataTypeWeight                    = "weight"
	DataTypeDailyRestingHeartRate     = "daily-resting-heart-rate"
	DataTypeHeartRate                 = "heart-rate"
	DataTypeDailyHeartRateVariability = "daily-heart-rate-variability"
)

// DataSourceFamilyGoogleWearables limits reconcile to Fitbit / Pixel Watch trackers.
const DataSourceFamilyGoogleWearables = "users/me/dataSourceFamilies/google-wearables"
