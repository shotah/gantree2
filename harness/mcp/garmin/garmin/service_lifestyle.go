package garmin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

// LifestyleLogDetail is an optional quantity detail for a behaviour (e.g. beer count).
type LifestyleLogDetail struct {
	SubTypeID   *int     `json:"subTypeId,omitempty"`
	SubTypeName *string  `json:"subTypeName,omitempty"`
	Amount      *float64 `json:"amount,omitempty"`
}

// LifestyleLogEntry is one behaviour on a day's lifestyle log.
// Note: Garmin uses British spelling behaviourId.
type LifestyleLogEntry struct {
	BehaviourID     int64                `json:"behaviourId"`
	MeasurementType string               `json:"measurementType"`
	CalendarDate    string               `json:"calendarDate"`
	Name            string               `json:"name"`
	LogStatus       string               `json:"logStatus"` // YES, NO, or empty if unlogged
	Category        string               `json:"category"`
	SleepRelated    bool                 `json:"sleepRelated"`
	Details         []LifestyleLogDetail `json:"details"`
}

// LifestyleCompletionStat is daily completion tracking.
type LifestyleCompletionStat struct {
	CalendarDate      string `json:"calendarDate"`
	TotalTracking     int    `json:"totalTracking"`
	CompletedTracking int    `json:"completedTracking"`
}

// DailyLifestyleLog is the lifestyle logging payload for a day.
type DailyLifestyleLog struct {
	DailyLogsReport []LifestyleLogEntry       `json:"dailyLogsReport"`
	CompletionStats []LifestyleCompletionStat `json:"completionStats"`
	raw             json.RawMessage
}

func (d *DailyLifestyleLog) RawJSON() json.RawMessage { return d.raw }

func (d *DailyLifestyleLog) SetRaw(data json.RawMessage) { d.raw = data }

// LifestyleBehaviour is a custom or system behaviour definition.
type LifestyleBehaviour struct {
	BehaviourID     int64  `json:"behaviourId"`
	UserProfilePK   int64  `json:"userProfilePk"`
	MeasurementType string `json:"measurementType"`
	Name            string `json:"name"`
	Hidden          bool   `json:"hidden"`
	Category        string `json:"category"`
	Tracked         bool   `json:"tracked"`
	AutoLoggable    bool   `json:"autoLoggable"`
	SleepRelated    bool   `json:"sleepRelated"`
	raw             json.RawMessage
}

func (b *LifestyleBehaviour) RawJSON() json.RawMessage { return b.raw }

func (b *LifestyleBehaviour) SetRaw(data json.RawMessage) { b.raw = data }

// LifestyleBehaviourRequest creates a custom lifestyle behaviour tag.
type LifestyleBehaviourRequest struct {
	Name         string `json:"name"`
	Category     string `json:"category"` // CUSTOM, CUSTOM_SLEEP_RELATED, …
	SleepRelated bool   `json:"sleepRelated"`
	Tracked      bool   `json:"tracked"`
}

// GetDaily retrieves lifestyle logging data for a date.
func (s *LifestyleService) GetDaily(ctx context.Context, date time.Time) (*DailyLifestyleLog, error) {
	path := "/lifestylelogging-service/dailyLog/" + date.Format("2006-01-02")
	return fetch[DailyLifestyleLog](ctx, s.client, path)
}

// CreateBehaviour creates a custom lifestyle behaviour tag.
// Daily YES/NO logging write path is not yet publicly documented (needs app HAR).
func (s *LifestyleService) CreateBehaviour(ctx context.Context, req *LifestyleBehaviourRequest) (*LifestyleBehaviour, error) {
	if req == nil {
		return nil, errors.New("lifestyle behaviour request is required")
	}
	if req.Name == "" {
		return nil, errors.New("name is required")
	}
	if req.Category == "" {
		req.Category = "CUSTOM"
	}
	return send[LifestyleBehaviour](ctx, s.client, http.MethodPost, "/lifestylelogging-service/behaviours", req)
}
