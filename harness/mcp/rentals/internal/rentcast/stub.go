package rentcast

import "context"

// Stub is an in-memory client for self-test / unit tests (no network).
type Stub struct {
	Usage *UsageTracker
}

// NewStub returns a non-nil RentalsAPI that returns canned empty results.
func NewStub() *Stub {
	return &Stub{Usage: NewUsageTrackerForTest("", defaultMonthlyQuota)}
}

func (s Stub) SearchListings(ctx context.Context, req ListingsSearchRequest) (*ListingsSearchResult, error) {
	if err := s.Usage.Gate(confirmSpendFromCtx(ctx)); err != nil {
		return nil, err
	}
	intent, err := NormalizeIntent(req.Intent)
	if err != nil {
		return nil, err
	}
	req.Intent = intent
	expanded, notes, err := ExpandSearchRequest(req)
	if err != nil {
		return nil, err
	}
	req = expanded
	if err := validateSearchRequest(req); err != nil {
		return nil, err
	}
	limit, offset := normalizePage(req.Limit, req.Offset)
	_, query := searchParams(req, limit, offset)
	return &ListingsSearchResult{
		Intent:   intent,
		Listings: []Listing{},
		Count:    0,
		Total:    0,
		Limit:    limit,
		Offset:   offset,
		Summary:  summarizeListings(nil, 0, limit, offset, intent),
		Query:    query,
		Note:     joinNotes("stub client", notes),
		Usage:    s.Usage.Snapshot(),
	}, nil
}

func (s Stub) GetListing(ctx context.Context, id, intent string) (*ListingGetResult, error) {
	if err := s.Usage.Gate(confirmSpendFromCtx(ctx)); err != nil {
		return nil, err
	}
	normalized, err := NormalizeIntent(intent)
	if err != nil {
		return nil, err
	}
	return &ListingGetResult{
		Listing: Listing{ID: id, Intent: normalized, Status: "stub"},
		Usage:   s.Usage.Snapshot(),
	}, nil
}

func (s Stub) RentEstimate(ctx context.Context, req RentEstimateRequest) (*RentEstimateResult, error) {
	if err := s.Usage.Gate(confirmSpendFromCtx(ctx)); err != nil {
		return nil, err
	}
	return &RentEstimateResult{Address: req.Address, Note: "stub client", Usage: s.Usage.Snapshot()}, nil
}

func (s Stub) MarketStats(ctx context.Context, zipCode string) (*MarketStatsResult, error) {
	if err := s.Usage.Gate(confirmSpendFromCtx(ctx)); err != nil {
		return nil, err
	}
	return &MarketStatsResult{ZipCode: zipCode, Note: "stub client", Usage: s.Usage.Snapshot()}, nil
}

func (s Stub) AccountUsage() *Usage {
	return s.Usage.Snapshot()
}
