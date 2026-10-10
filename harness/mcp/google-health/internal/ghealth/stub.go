package ghealth

import "context"

// Stub is an in-memory client for self-test / unit tests (no network).
type Stub struct{}

func NewStub() *Stub { return &Stub{} }

func (Stub) SleepGet(_ context.Context, req SleepGetRequest) (*SleepListResult, error) {
	return &SleepListResult{
		Sessions: []SleepResult{{Date: req.Date, Note: "stub client"}},
		Count:    1,
		Note:     sleepAPINote,
	}, nil
}

func (Stub) ActivitiesList(_ context.Context, _ ActivitiesListRequest) (*ActivitiesListResult, error) {
	return &ActivitiesListResult{Activities: []Activity{}, Count: 0, Note: "stub client"}, nil
}

func (Stub) ActivitiesGet(_ context.Context, id string) (*Activity, error) {
	return &Activity{ID: id, Name: "stub activity"}, nil
}

func (Stub) HeartRateGet(_ context.Context, req HeartRateRequest) (*HeartRateListResult, error) {
	return &HeartRateListResult{
		Entries: []HeartRateResult{{Date: req.Date, Note: "stub client"}},
		Count:   1,
	}, nil
}

func (Stub) HRVGet(_ context.Context, req HRVRequest) (*HRVListResult, error) {
	return &HRVListResult{
		Entries: []HRVResult{{Date: req.Date, Note: "stub client"}},
		Count:   1,
	}, nil
}

func (Stub) WeightGet(_ context.Context, _ WeightRequest) (*WeightResult, error) {
	return &WeightResult{Entries: nil, Note: "stub client"}, nil
}

func (Stub) ProfileGet(_ context.Context) (*Profile, error) {
	return &Profile{DisplayName: "stub", Note: "stub client"}, nil
}

func (Stub) AccountStatus() map[string]any {
	return map[string]any{
		"provider":      "Google Health API",
		"authenticated": true,
		"note":          "stub client",
		"host_id":       "ghealth",
	}
}
