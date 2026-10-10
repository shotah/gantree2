package garmin

import (
	"context"
	"encoding/json"
	"fmt"
)

// Badge is a Garmin Connect badge definition / earned badge.
type Badge struct {
	BadgeID            int64    `json:"badgeId"`
	BadgeKey           string   `json:"badgeKey"`
	BadgeName          string   `json:"badgeName"`
	BadgeCategoryID    *int     `json:"badgeCategoryId"`
	BadgeDifficultyID  *int     `json:"badgeDifficultyId"`
	BadgePoints        *int     `json:"badgePoints"`
	BadgeSeriesID      *int64   `json:"badgeSeriesId"`
	BadgeStartDate     *string  `json:"badgeStartDate"`
	BadgeEndDate       *string  `json:"badgeEndDate"`
	BadgeEarnedDate    *string  `json:"badgeEarnedDate"`
	BadgeEarnedNumber  *int     `json:"badgeEarnedNumber"`
	BadgeIsViewed      *bool    `json:"badgeIsViewed"`
	BadgeProgressValue *float64 `json:"badgeProgressValue"`
	BadgeTargetValue   *float64 `json:"badgeTargetValue"`
	BadgeUnitID        *int     `json:"badgeUnitId"`
	EarnedByMe         *bool    `json:"earnedByMe"`
}

// BadgeList is a list of badges.
type BadgeList struct {
	Entries []Badge
	raw     json.RawMessage
}

func (b *BadgeList) RawJSON() json.RawMessage { return b.raw }

func (b *BadgeList) SetRaw(data json.RawMessage) { b.raw = data }

func (b *BadgeList) UnmarshalJSON(data []byte) error {
	var arr []Badge
	if err := json.Unmarshal(data, &arr); err == nil {
		b.Entries = arr
		return nil
	}
	var wrap struct {
		BadgeList []Badge `json:"badgeList"`
	}
	if err := json.Unmarshal(data, &wrap); err != nil {
		return err
	}
	b.Entries = wrap.BadgeList
	return nil
}

// BadgeChallenge is a badge or virtual challenge entry.
type BadgeChallenge struct {
	BadgeChallengeID *int64   `json:"badgeChallengeId"`
	Name             string   `json:"name"`
	StartDate        *string  `json:"startDate"`
	EndDate          *string  `json:"endDate"`
	Status           *string  `json:"status"`
	ProgressValue    *float64 `json:"progressValue"`
	TargetValue      *float64 `json:"targetValue"`
	Badges           []Badge  `json:"badges"`
}

// BadgeChallengeList is a paginated list of challenges.
type BadgeChallengeList struct {
	Entries []BadgeChallenge
	raw     json.RawMessage
}

func (b *BadgeChallengeList) RawJSON() json.RawMessage { return b.raw }

func (b *BadgeChallengeList) SetRaw(data json.RawMessage) { b.raw = data }

func (b *BadgeChallengeList) UnmarshalJSON(data []byte) error {
	var arr []BadgeChallenge
	if err := json.Unmarshal(data, &arr); err == nil {
		b.Entries = arr
		return nil
	}
	var wrap map[string]json.RawMessage
	if err := json.Unmarshal(data, &wrap); err != nil {
		return err
	}
	for _, key := range []string{"badgeChallengeList", "virtualChallengeList", "adHocChallengeList", "challenges"} {
		if raw, ok := wrap[key]; ok {
			return json.Unmarshal(raw, &b.Entries)
		}
	}
	return nil
}

// ListEarned retrieves badges the user has earned.
func (s *BadgeService) ListEarned(ctx context.Context) (*BadgeList, error) {
	return fetch[BadgeList](ctx, s.client, "/badge-service/badge/earned")
}

// ListAvailable retrieves available badges.
func (s *BadgeService) ListAvailable(ctx context.Context) (*BadgeList, error) {
	return fetch[BadgeList](ctx, s.client, "/badge-service/badge/available?showExclusiveBadge=true")
}

func challengePath(base string, start, limit int) string {
	return fmt.Sprintf("%s?start=%d&limit=%d", base, start, limit)
}

// ListCompletedChallenges retrieves completed badge challenges.
func (s *BadgeService) ListCompletedChallenges(ctx context.Context, start, limit int) (*BadgeChallengeList, error) {
	return fetch[BadgeChallengeList](ctx, s.client, challengePath("/badgechallenge-service/badgeChallenge/completed", start, limit))
}

// ListAvailableChallenges retrieves available badge challenges.
func (s *BadgeService) ListAvailableChallenges(ctx context.Context, start, limit int) (*BadgeChallengeList, error) {
	return fetch[BadgeChallengeList](ctx, s.client, challengePath("/badgechallenge-service/badgeChallenge/available", start, limit))
}

// ListNonCompletedChallenges retrieves non-completed badge challenges.
func (s *BadgeService) ListNonCompletedChallenges(ctx context.Context, start, limit int) (*BadgeChallengeList, error) {
	return fetch[BadgeChallengeList](ctx, s.client, challengePath("/badgechallenge-service/badgeChallenge/non-completed", start, limit))
}

// ListVirtualChallengesInProgress retrieves in-progress virtual challenges.
func (s *BadgeService) ListVirtualChallengesInProgress(ctx context.Context, start, limit int) (*BadgeChallengeList, error) {
	return fetch[BadgeChallengeList](ctx, s.client, challengePath("/badgechallenge-service/virtualChallenge/inProgress", start, limit))
}

// ListAdHocHistorical retrieves historical ad-hoc challenges.
func (s *BadgeService) ListAdHocHistorical(ctx context.Context, start, limit int) (*BadgeChallengeList, error) {
	return fetch[BadgeChallengeList](ctx, s.client, challengePath("/adhocchallenge-service/adHocChallenge/historical", start, limit))
}
