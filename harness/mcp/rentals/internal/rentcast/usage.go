package rentcast

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultMonthlyQuota = 50
	defaultSoftHeadroom = 10 // last N requests require confirm_spend

	capStateOK        = "ok"
	capStateConfirm   = "confirm_required"
	capStateExhausted = "exhausted"
	capStateOverage   = "overage"
)

// QuotaKind is why a billed call was blocked.
type QuotaKind string

const (
	QuotaKindHard QuotaKind = "hard"
	QuotaKindSoft QuotaKind = "soft"
)

var (
	// ErrQuotaExhausted is the hard cap (default 50). The model cannot bypass it.
	ErrQuotaExhausted = errors.New("rentcast monthly quota exhausted")
	// ErrQuotaConfirmNeeded is the soft cap. Re-call with confirm_spend=true.
	ErrQuotaConfirmNeeded = errors.New("rentcast soft cap: confirm_spend required")
)

type confirmSpendCtxKey struct{}

// WithConfirmSpend marks a billed tool call as an explicit spend of one remaining request.
// Only bypasses the soft cap — never the hard cap.
func WithConfirmSpend(ctx context.Context, confirm bool) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	if !confirm {
		return ctx
	}
	return context.WithValue(ctx, confirmSpendCtxKey{}, true)
}

func confirmSpendFromCtx(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	v, _ := ctx.Value(confirmSpendCtxKey{}).(bool)
	return v
}

// QuotaError is returned when a billed call is blocked before any HTTP.
type QuotaError struct {
	Kind  QuotaKind
	Usage *Usage
}

func (e *QuotaError) Error() string {
	if e == nil {
		return ErrQuotaExhausted.Error()
	}
	u := e.Usage
	if u == nil {
		if e.Kind == QuotaKindSoft {
			return ErrQuotaConfirmNeeded.Error()
		}
		return ErrQuotaExhausted.Error()
	}
	if e.Kind == QuotaKindSoft {
		return fmt.Sprintf(
			"SOFT CAP (%d/%d used, %d left this month). Call was NOT sent — 0 RentCast requests billed. "+
				"Re-call this same tool with confirm_spend=true to spend 1 of the remaining %d. "+
				"Combine neighborhoods/zips/types into ONE listings_search, or use link_format (free). "+
				"confirm_spend cannot bypass the hard cap of %d. Local counter resets %s.",
			u.RequestsUsed, u.RequestsPerMonth, u.RequestsLeft, u.RequestsLeft, u.RequestsPerMonth, u.PeriodResets,
		)
	}
	return fmt.Sprintf(
		"HARD CAP (%d/%d used). Call was NOT sent — 0 RentCast requests billed. "+
			"Do not retry listings_search, listings_get, rent_estimate_get, or markets_get. "+
			"Use link_format (free) or wait until %s. "+
			"A human who upgraded the RentCast plan can set RENTCAST_ALLOW_OVERAGE=1 in the MCP env; the model cannot unlock this.",
		u.RequestsUsed, u.RequestsPerMonth, u.PeriodResets,
	)
}

func (e *QuotaError) Unwrap() error {
	if e != nil && e.Kind == QuotaKindSoft {
		return ErrQuotaConfirmNeeded
	}
	return ErrQuotaExhausted
}

// Usage is a local quota snapshot (RentCast has no public account API).
type Usage struct {
	RequestsUsed     int    `json:"requests_used"`
	RequestsLeft     int    `json:"requests_left"`
	RequestsPerMonth int    `json:"requests_per_month"`
	SoftCap          int    `json:"soft_cap"`
	CapState         string `json:"cap_state"` // ok | confirm_required | exhausted | overage
	ConfirmRequired  bool   `json:"confirm_required"`
	HardCapped       bool   `json:"hard_capped"`
	AllowOverage     bool   `json:"allow_overage"`
	Period           string `json:"period"`        // YYYY-MM (local calendar month)
	PeriodResets     string `json:"period_resets"` // first day of next calendar month (approx)
	Source           string `json:"source"`        // local_counter
	Persistent       bool   `json:"persistent"`    // false if in-memory only
	QuotaWarning     string `json:"quota_warning,omitempty"`
	Note             string `json:"note,omitempty"`
}

type usageFile struct {
	Period string `json:"period"`
	Count  int    `json:"count"`
}

// UsageTracker counts successful RentCast HTTP calls locally and gates new ones.
type UsageTracker struct {
	mu           sync.Mutex
	path         string
	quota        int
	softCap      int
	allowOverage bool
	period       string
	count        int
	loaded       bool
	disabled     bool
}

// NewUsageTrackerFromEnv builds a tracker. Disable with RENTCAST_USAGE_TRACK=0
// (also disables soft/hard caps). Optional: RENTCAST_USAGE_FILE,
// RENTCAST_MONTHLY_QUOTA (default 50), RENTCAST_SOFT_CAP (default quota-10;
// 0 = hard cap only), RENTCAST_ALLOW_OVERAGE=1 (human-only hard-cap bypass).
func NewUsageTrackerFromEnv() *UsageTracker {
	if disabledEnv(os.Getenv("RENTCAST_USAGE_TRACK")) {
		return &UsageTracker{disabled: true, quota: defaultMonthlyQuota}
	}
	quota := defaultMonthlyQuota
	if v := strings.TrimSpace(os.Getenv("RENTCAST_MONTHLY_QUOTA")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			quota = n
		}
	}
	soft := defaultSoftCap(quota)
	if v := strings.TrimSpace(os.Getenv("RENTCAST_SOFT_CAP")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			soft = n
		}
	}
	path := strings.TrimSpace(os.Getenv("RENTCAST_USAGE_FILE"))
	if path == "" {
		if dir, err := os.UserConfigDir(); err == nil && dir != "" {
			path = filepath.Join(dir, "rentals-search-mcp", "usage.json")
		}
	}
	return &UsageTracker{
		path:         path,
		quota:        quota,
		softCap:      soft,
		allowOverage: enabledEnv(os.Getenv("RENTCAST_ALLOW_OVERAGE")),
	}
}

// NewUsageTrackerForTest creates a tracker writing under path (tests).
func NewUsageTrackerForTest(path string, quota int) *UsageTracker {
	if quota <= 0 {
		quota = defaultMonthlyQuota
	}
	return &UsageTracker{path: path, quota: quota, softCap: defaultSoftCap(quota)}
}

func defaultSoftCap(quota int) int {
	if quota <= defaultSoftHeadroom {
		return 0
	}
	return quota - defaultSoftHeadroom
}

func disabledEnv(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "0", "false", "off", "no":
		return true
	default:
		return false
	}
}

func enabledEnv(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "on", "yes":
		return true
	default:
		return false
	}
}

func (t *UsageTracker) Snapshot() *Usage {
	if t == nil || t.disabled {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.ensureLoadedLocked(time.Now())
	return t.snapshotLocked(time.Now())
}

// Gate blocks billed calls before HTTP. confirm=true (confirm_spend) bypasses
// the soft cap only. The hard cap requires RENTCAST_ALLOW_OVERAGE (human env).
func (t *UsageTracker) Gate(confirm bool) error {
	if t == nil || t.disabled {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now()
	t.ensureLoadedLocked(now)
	snap := t.snapshotLocked(now)
	if snap.HardCapped {
		return &QuotaError{Kind: QuotaKindHard, Usage: snap}
	}
	if snap.ConfirmRequired && !confirm {
		return &QuotaError{Kind: QuotaKindSoft, Usage: snap}
	}
	return nil
}

// RecordSuccess increments after a successful (2xx) RentCast response.
func (t *UsageTracker) RecordSuccess() {
	if t == nil || t.disabled {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now()
	t.ensureLoadedLocked(now)
	period := now.Format("2006-01")
	if t.period != period {
		t.period = period
		t.count = 0
	}
	t.count++
	t.persistLocked()
}

func (t *UsageTracker) ensureLoadedLocked(now time.Time) {
	if t.loaded {
		period := now.Format("2006-01")
		if t.period != "" && t.period != period {
			t.period = period
			t.count = 0
		}
		return
	}
	t.loaded = true
	t.period = now.Format("2006-01")
	if t.path == "" {
		return
	}
	data, err := os.ReadFile(t.path)
	if err != nil {
		return
	}
	var f usageFile
	if json.Unmarshal(data, &f) != nil || f.Period == "" {
		return
	}
	if f.Period == t.period {
		t.count = max(0, f.Count)
	}
}

func (t *UsageTracker) persistLocked() {
	if t.path == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(t.path), 0o755); err != nil { //nolint:gosec // G301: local usage dir
		return
	}
	data, err := json.MarshalIndent(usageFile{Period: t.period, Count: t.count}, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(t.path, append(data, '\n'), 0o644) //nolint:gosec // G306: non-secret local counter
}

func (t *UsageTracker) snapshotLocked(now time.Time) *Usage {
	left := max(0, t.quota-t.count)
	next := time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, now.Location())
	state, confirmReq, hard, warning := t.capFlagsLocked()
	note := "Local counter of successful RentCast calls from this machine/binary. " +
		"Resets on the 1st of each calendar month (local time) — period_resets is that date. " +
		"Soft cap requires confirm_spend=true on billed tools; hard cap cannot be bypassed by the model. " +
		"Not the official dashboard; RentCast's billing cycle may differ. Verify at https://app.rentcast.io/ when unsure."
	if t.path == "" {
		note = "In-memory only (no writable usage file). " + note
	}
	return &Usage{
		RequestsUsed:     t.count,
		RequestsLeft:     left,
		RequestsPerMonth: t.quota,
		SoftCap:          t.softCap,
		CapState:         state,
		ConfirmRequired:  confirmReq,
		HardCapped:       hard,
		AllowOverage:     t.allowOverage,
		Period:           t.period,
		PeriodResets:     next.Format("2006-01-02"),
		Source:           "local_counter",
		Persistent:       t.path != "",
		QuotaWarning:     warning,
		Note:             note,
	}
}

func (t *UsageTracker) capFlagsLocked() (state string, confirmReq, hard bool, warning string) {
	overQuota := t.count >= t.quota
	if t.allowOverage {
		if overQuota {
			return capStateOverage, false, false,
				"Local count is at or past the monthly quota; RENTCAST_ALLOW_OVERAGE=1 is set. Dashboard remains source of truth."
		}
		return capStateOK, false, false, ""
	}
	if overQuota {
		return capStateExhausted, false, true,
			"Hard cap reached. Do not retry billed tools. Use link_format or wait until period_resets. The model cannot unlock this."
	}
	if t.softCap > 0 && t.count >= t.softCap {
		return capStateConfirm, true, false,
			"Soft cap reached. Next billed call requires confirm_spend=true (1 of the remaining requests). Or use link_format (free)."
	}
	return capStateOK, false, false, ""
}
