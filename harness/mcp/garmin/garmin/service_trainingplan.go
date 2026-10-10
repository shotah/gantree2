package garmin

import (
	"context"
	"encoding/json"
	"fmt"
)

// TrainingPlanSummary is one plan in the training plan list.
type TrainingPlanSummary struct {
	TrainingPlanID       int64  `json:"trainingPlanId"`
	Name                 string `json:"name"`
	TrainingPlanCategory string `json:"trainingPlanCategory"` // e.g. FBT_ADAPTIVE
}

// TrainingPlanList is the list of training plans.
type TrainingPlanList struct {
	TrainingPlanList []TrainingPlanSummary `json:"trainingPlanList"`
	raw              json.RawMessage
}

func (t *TrainingPlanList) RawJSON() json.RawMessage { return t.raw }

func (t *TrainingPlanList) SetRaw(data json.RawMessage) { t.raw = data }

// TrainingPlanDetail is a phased or adaptive training plan payload.
// The schedule is large and varies by plan type — keep RawJSON for full detail.
type TrainingPlanDetail struct {
	TrainingPlanID       int64  `json:"trainingPlanId"`
	Name                 string `json:"name"`
	TrainingPlanCategory string `json:"trainingPlanCategory"`
	raw                  json.RawMessage
}

func (t *TrainingPlanDetail) RawJSON() json.RawMessage { return t.raw }

func (t *TrainingPlanDetail) SetRaw(data json.RawMessage) { t.raw = data }

func (t *TrainingPlanDetail) UnmarshalJSON(data []byte) error {
	type alias TrainingPlanDetail
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*t = TrainingPlanDetail(a)
	t.raw = append(json.RawMessage(nil), data...)
	return nil
}

// List retrieves training plans for the current user.
func (s *TrainingPlanService) List(ctx context.Context) (*TrainingPlanList, error) {
	return fetch[TrainingPlanList](ctx, s.client, "/trainingplan-service/trainingplan/plans")
}

// GetPhased retrieves a phased training plan by ID.
func (s *TrainingPlanService) GetPhased(ctx context.Context, planID int64) (*TrainingPlanDetail, error) {
	path := fmt.Sprintf("/trainingplan-service/trainingplan/phased/%d", planID)
	return fetch[TrainingPlanDetail](ctx, s.client, path)
}

// GetAdaptive retrieves an FBT adaptive (Garmin Coach) plan by ID.
func (s *TrainingPlanService) GetAdaptive(ctx context.Context, planID int64) (*TrainingPlanDetail, error) {
	path := fmt.Sprintf("/trainingplan-service/trainingplan/fbt-adaptive/%d", planID)
	return fetch[TrainingPlanDetail](ctx, s.client, path)
}

// Get retrieves a plan using the category from List (FBT_ADAPTIVE → adaptive, else phased).
func (s *TrainingPlanService) Get(ctx context.Context, planID int64, category string) (*TrainingPlanDetail, error) {
	if category == "FBT_ADAPTIVE" {
		return s.GetAdaptive(ctx, planID)
	}
	return s.GetPhased(ctx, planID)
}
