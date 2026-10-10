package pendant

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"
)

// pendingLogs is how many frames we hold before the socket sender is attached.
const pendingLogs = 64

// LogBridge tees slog onto the mailbox: "turn perf" becomes a perf frame,
// everything else a rate-capped log frame. Until SetSend, a short queue holds
// the frames so boot lines are not dropped.
type LogBridge struct {
	next  slog.Handler
	state *bridgeState
}

type bridgeState struct {
	mu      sync.Mutex
	send    func([]byte)
	pending [][]byte
	lim     *LogLimiter
	busy    atomic.Bool
}

// NewLogBridge wraps next. every is the log-frame gap; zero uses LogMinInterval.
// Perf frames are not rate-capped.
func NewLogBridge(next slog.Handler, every time.Duration) *LogBridge {
	if next == nil {
		next = slog.DiscardHandler
	}
	return &LogBridge{
		next: next,
		state: &bridgeState{
			lim: &LogLimiter{Interval: every},
		},
	}
}

// SetSend attaches the socket writer and flushes frames queued before it.
// Later calls replace the writer. nil disables sending and drops the queue.
func (b *LogBridge) SetSend(fn func([]byte)) {
	if b == nil {
		return
	}
	b.state.mu.Lock()
	b.state.send = fn
	pending := b.state.pending
	b.state.pending = nil
	b.state.mu.Unlock()
	if fn == nil {
		return
	}
	for _, raw := range pending {
		fn(raw)
	}
}

// Enabled reports whether next would handle the level.
func (b *LogBridge) Enabled(ctx context.Context, level slog.Level) bool {
	return b.next.Enabled(ctx, level)
}

// Handle writes to next, then may emit a perf or log frame.
func (b *LogBridge) Handle(ctx context.Context, rec slog.Record) error {
	err := b.next.Handle(ctx, rec)
	if rec.Message == "turn perf" {
		raw, encErr := EncodePerf(perfFromRecord(rec))
		if encErr == nil {
			b.emit(raw)
		}
		return err
	}
	ok, dropped := b.state.lim.Allow(rec.Time)
	if !ok {
		return err
	}
	at := rec.Time
	if at.IsZero() {
		at = time.Now()
	}
	raw, encErr := EncodeLog(LogFrame{
		Level:   rec.Level.String(),
		Message: rec.Message,
		At:      at.UTC().Format(time.RFC3339Nano),
		Dropped: dropped,
	})
	if encErr == nil {
		b.emit(raw)
	}
	return err
}

// WithAttrs returns a child that shares the sender and the rate limiter.
func (b *LogBridge) WithAttrs(attrs []slog.Attr) slog.Handler {
	if len(attrs) == 0 {
		return b
	}
	return &LogBridge{next: b.next.WithAttrs(attrs), state: b.state}
}

// WithGroup returns a child that shares the sender and the rate limiter.
func (b *LogBridge) WithGroup(name string) slog.Handler {
	if name == "" {
		return b
	}
	return &LogBridge{next: b.next.WithGroup(name), state: b.state}
}

func (b *LogBridge) emit(raw []byte) {
	if len(raw) == 0 || b == nil {
		return
	}
	if !b.state.busy.CompareAndSwap(false, true) {
		return
	}
	defer b.state.busy.Store(false)

	b.state.mu.Lock()
	send := b.state.send
	if send == nil {
		if len(b.state.pending) < pendingLogs {
			b.state.pending = append(b.state.pending, append([]byte(nil), raw...))
		}
		b.state.mu.Unlock()
		return
	}
	b.state.mu.Unlock()
	send(raw)
}

func perfFromRecord(rec slog.Record) PerfFrame {
	f := PerfFrame{Kind: KindPerf}
	rec.Attrs(func(a slog.Attr) bool {
		switch a.Key {
		case "session_id":
			f.Turn = a.Value.String()
		case "source":
			f.Source = a.Value.String()
		case "outcome":
			f.Outcome = a.Value.String()
		case "prompt_tokens":
			f.Tokens.Prompt = attrInt(a.Value)
		case "completion_tokens":
			f.Tokens.Completion = attrInt(a.Value)
		}
		return true
	})
	return f
}

func attrInt(v slog.Value) int {
	switch v.Kind() {
	case slog.KindInt64:
		return int(v.Int64())
	case slog.KindUint64:
		return int(v.Uint64())
	case slog.KindFloat64:
		return int(v.Float64())
	default:
		return 0
	}
}
