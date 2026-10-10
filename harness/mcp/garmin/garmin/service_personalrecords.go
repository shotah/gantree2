package garmin

import (
	"context"
	"encoding/json"
	"time"
)

// PersonalRecord is a single all-time personal record.
type PersonalRecord struct {
	TypeID                  int     `json:"typeId"`
	Value                   float64 `json:"value"`
	ActivityType            *string `json:"activityType"`
	ActivityID              *int64  `json:"activityId"`
	ActivityName            *string `json:"activityName"`
	PRStartTimeGMTFormatted string  `json:"prStartTimeGmtFormatted"`
	PRTypeLabelKey          *string `json:"prTypeLabelKey"`
}

// PersonalRecords is the list of personal records for a user.
type PersonalRecords struct {
	Entries []PersonalRecord
	raw     json.RawMessage
}

func (p *PersonalRecords) RawJSON() json.RawMessage { return p.raw }

func (p *PersonalRecords) SetRaw(data json.RawMessage) { p.raw = data }

func (p *PersonalRecords) UnmarshalJSON(data []byte) error {
	return json.Unmarshal(data, &p.Entries)
}

// List retrieves all-time personal records for the given display name.
func (s *PersonalRecordsService) List(ctx context.Context, displayName string) (*PersonalRecords, error) {
	return fetch[PersonalRecords](ctx, s.client, "/personalrecord-service/personalrecord/prs/"+displayName)
}

// Convenience: duration helpers for time-based PRs (typeId 1–6 are seconds).
func (p PersonalRecord) Duration() time.Duration {
	return time.Duration(p.Value * float64(time.Second))
}
