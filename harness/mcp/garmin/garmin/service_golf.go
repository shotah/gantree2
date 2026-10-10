package garmin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// GolfScorecardSummary is a golf round summary from the golf community API.
type GolfScorecardSummary struct {
	ID                 int64   `json:"id"`
	PlayerProfileID    *int64  `json:"playerProfileId"`
	CourseName         *string `json:"courseName"`
	StartTime          *string `json:"startTime"`
	FormattedStartTime *string `json:"formattedStartTime"`
	Score              *int    `json:"score"`
	Strokes            *int    `json:"strokes"`
	HolesCompleted     *int    `json:"holesCompleted"`
}

// GolfScorecardSummaries is a list of golf round summaries.
type GolfScorecardSummaries struct {
	ScorecardSummaries []GolfScorecardSummary `json:"scorecardSummaries"`
	raw                json.RawMessage
}

func (g *GolfScorecardSummaries) RawJSON() json.RawMessage { return g.raw }

func (g *GolfScorecardSummaries) SetRaw(data json.RawMessage) { g.raw = data }

func (g *GolfScorecardSummaries) UnmarshalJSON(data []byte) error {
	// Empty accounts return {"pageNumber":1,"rowsPerPage":20,"totalRows":0} with no list key.
	var wrap struct {
		ScorecardSummaries []GolfScorecardSummary `json:"scorecardSummaries"`
	}
	if len(data) > 0 && data[0] == '{' {
		if err := json.Unmarshal(data, &wrap); err != nil {
			return err
		}
		if wrap.ScorecardSummaries == nil {
			g.ScorecardSummaries = []GolfScorecardSummary{}
		} else {
			g.ScorecardSummaries = wrap.ScorecardSummaries
		}
		return nil
	}
	var arr []GolfScorecardSummary
	if err := json.Unmarshal(data, &arr); err != nil {
		return err
	}
	g.ScorecardSummaries = arr
	return nil
}

// FirstID returns the first scorecard id, or 0 if empty.
func (g *GolfScorecardSummaries) FirstID() int64 {
	if g == nil || len(g.ScorecardSummaries) == 0 {
		return 0
	}
	return g.ScorecardSummaries[0].ID
}

// GolfScorecardDetail is detailed scorecard payload for one or more scorecard IDs.
// The Connect response shape varies; use RawJSON() for the full body.
type GolfScorecardDetail struct {
	raw json.RawMessage
}

func (g *GolfScorecardDetail) RawJSON() json.RawMessage { return g.raw }

func (g *GolfScorecardDetail) SetRaw(data json.RawMessage) { g.raw = data }

func (g *GolfScorecardDetail) UnmarshalJSON(data []byte) error {
	g.raw = append(json.RawMessage(nil), data...)
	return nil
}

// GolfShotData is shot-by-shot data for holes on a scorecard.
type GolfShotData struct {
	raw json.RawMessage
}

func (g *GolfShotData) RawJSON() json.RawMessage { return g.raw }

func (g *GolfShotData) SetRaw(data json.RawMessage) { g.raw = data }

func (g *GolfShotData) UnmarshalJSON(data []byte) error {
	g.raw = append(json.RawMessage(nil), data...)
	return nil
}

// ListScorecards retrieves paginated golf scorecard summaries.
func (s *GolfService) ListScorecards(ctx context.Context, start, limit int) (*GolfScorecardSummaries, error) {
	if start < 0 {
		start = 0
	}
	if limit <= 0 {
		limit = 20
	}
	path := fmt.Sprintf(
		"/gcs-golfcommunity/api/v2/scorecard/summary?per-page=%d&start=%d",
		limit,
		start,
	)
	return fetch[GolfScorecardSummaries](ctx, s.client, path)
}

// GetScorecard retrieves detailed scorecard data for a scorecard ID.
func (s *GolfService) GetScorecard(ctx context.Context, scorecardID int64) (*GolfScorecardDetail, error) {
	if scorecardID <= 0 {
		return nil, errors.New("scorecard id must be > 0")
	}
	q := url.Values{}
	q.Set("scorecard-ids", strconv.FormatInt(scorecardID, 10))
	q.Set("include-longest-shot-distance", "true")
	path := "/gcs-golfcommunity/api/v2/scorecard/detail?" + q.Encode()
	return fetch[GolfScorecardDetail](ctx, s.client, path)
}

// GetShotData retrieves shot-by-shot data for holes on a scorecard.
// holeNumbers is a comma-separated list (default all 18 holes).
func (s *GolfService) GetShotData(ctx context.Context, scorecardID int64, holeNumbers string) (*GolfShotData, error) {
	if scorecardID <= 0 {
		return nil, errors.New("scorecard id must be > 0")
	}
	if strings.TrimSpace(holeNumbers) == "" {
		holeNumbers = "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18"
	}
	q := url.Values{}
	q.Set("hole-numbers", holeNumbers)
	path := fmt.Sprintf(
		"/gcs-golfcommunity/api/v2/shot/scorecard/%d/hole?%s",
		scorecardID,
		q.Encode(),
	)
	return fetch[GolfShotData](ctx, s.client, path)
}
