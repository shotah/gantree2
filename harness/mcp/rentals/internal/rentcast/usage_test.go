package rentcast

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestUsageTrackerPersistAndResetMonth(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage.json")
	tr := NewUsageTrackerForTest(path, 50)
	tr.RecordSuccess()
	tr.RecordSuccess()
	snap := tr.Snapshot()
	if snap.RequestsUsed != 2 || snap.RequestsLeft != 48 || !snap.Persistent {
		t.Fatalf("%+v", snap)
	}
	if snap.SoftCap != 40 || snap.CapState != capStateOK || snap.ConfirmRequired || snap.HardCapped {
		t.Fatalf("caps %+v", snap)
	}

	tr2 := NewUsageTrackerForTest(path, 50)
	snap2 := tr2.Snapshot()
	if snap2.RequestsUsed != 2 {
		t.Fatalf("reload got %+v", snap2)
	}
}

func TestUsageTrackerDisabled(t *testing.T) {
	t.Setenv("RENTCAST_USAGE_TRACK", "0")
	tr := NewUsageTrackerFromEnv()
	tr.RecordSuccess()
	if tr.Snapshot() != nil {
		t.Fatal("expected nil when disabled")
	}
	if err := tr.Gate(false); err != nil {
		t.Fatalf("disabled tracker must not gate: %v", err)
	}
}

func TestUsageTrackerQuotaEnv(t *testing.T) {
	t.Setenv("RENTCAST_USAGE_TRACK", "1")
	t.Setenv("RENTCAST_MONTHLY_QUOTA", "10")
	t.Setenv("RENTCAST_USAGE_FILE", filepath.Join(t.TempDir(), "u.json"))
	tr := NewUsageTrackerFromEnv()
	for range 3 {
		tr.RecordSuccess()
	}
	snap := tr.Snapshot()
	if snap.RequestsPerMonth != 10 || snap.RequestsLeft != 7 {
		t.Fatalf("%+v", snap)
	}
	if snap.SoftCap != 0 {
		t.Fatalf("quota 10 should disable soft cap, got %+v", snap)
	}
}

func TestUsageTrackerSoftCapEnv(t *testing.T) {
	t.Setenv("RENTCAST_USAGE_TRACK", "1")
	t.Setenv("RENTCAST_MONTHLY_QUOTA", "50")
	t.Setenv("RENTCAST_SOFT_CAP", "5")
	t.Setenv("RENTCAST_USAGE_FILE", filepath.Join(t.TempDir(), "u.json"))
	tr := NewUsageTrackerFromEnv()
	for range 5 {
		tr.RecordSuccess()
	}
	snap := tr.Snapshot()
	if snap.SoftCap != 5 || snap.CapState != capStateConfirm || !snap.ConfirmRequired {
		t.Fatalf("%+v", snap)
	}
}

func TestUsageTrackerAllowOverageEnv(t *testing.T) {
	t.Setenv("RENTCAST_USAGE_TRACK", "1")
	t.Setenv("RENTCAST_ALLOW_OVERAGE", "1")
	t.Setenv("RENTCAST_USAGE_FILE", filepath.Join(t.TempDir(), "u.json"))
	tr := NewUsageTrackerFromEnv()
	for range defaultMonthlyQuota {
		tr.RecordSuccess()
	}
	if err := tr.Gate(false); err != nil {
		t.Fatalf("overage must skip hard cap: %v", err)
	}
	snap := tr.Snapshot()
	if snap.CapState != capStateOverage || snap.HardCapped || snap.ConfirmRequired {
		t.Fatalf("%+v", snap)
	}
}

func TestUsageTrackerGateSoftAndHard(t *testing.T) {
	tr := NewUsageTrackerForTest(filepath.Join(t.TempDir(), "u.json"), 50)
	for range 40 {
		tr.RecordSuccess()
	}
	err := tr.Gate(false)
	if !errors.Is(err, ErrQuotaConfirmNeeded) {
		t.Fatalf("soft gate: %v", err)
	}
	var qe *QuotaError
	if !errors.As(err, &qe) || qe.Kind != QuotaKindSoft || !strings.Contains(err.Error(), "confirm_spend=true") {
		t.Fatalf("soft error: %v", err)
	}
	if err := tr.Gate(true); err != nil {
		t.Fatalf("confirm should pass soft cap: %v", err)
	}

	for range 10 {
		tr.RecordSuccess()
	}
	err = tr.Gate(true)
	if !errors.Is(err, ErrQuotaExhausted) {
		t.Fatalf("hard gate: %v", err)
	}
	if !errors.As(err, &qe) || qe.Kind != QuotaKindHard || !strings.Contains(err.Error(), "RENTCAST_ALLOW_OVERAGE=1") {
		t.Fatalf("hard error: %v", err)
	}
	snap := tr.Snapshot()
	if snap.RequestsUsed != 50 || snap.CapState != capStateExhausted || !snap.HardCapped {
		t.Fatalf("%+v", snap)
	}
}

func TestUsageTrackerGateMonthReset(t *testing.T) {
	tr := NewUsageTrackerForTest(filepath.Join(t.TempDir(), "u.json"), 50)
	for range 50 {
		tr.RecordSuccess()
	}
	tr.mu.Lock()
	tr.period = "2020-01"
	tr.count = 50
	tr.loaded = true
	tr.mu.Unlock()

	if err := tr.Gate(false); err != nil {
		t.Fatalf("new month should clear cap: %v", err)
	}
	snap := tr.Snapshot()
	if snap.RequestsUsed != 0 || snap.Period != time.Now().Format("2006-01") || snap.CapState != capStateOK {
		t.Fatalf("%+v", snap)
	}
}

func TestQuotaErrorNil(t *testing.T) {
	var e *QuotaError
	if e.Error() == "" {
		t.Fatal("nil QuotaError should still stringify")
	}
	if !errors.Is(e, ErrQuotaExhausted) {
		t.Fatal("nil unwrap hard")
	}
}
