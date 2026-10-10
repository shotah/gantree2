package chat

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// Agent DO frames. They ride the same mailbox socket as chat.
//
// The DO sends config. The harness sends status, perf, log, and snapshot.
// Chat frames (reply, push, allow, …) are unchanged. A worker that does not
// know these kinds should ignore them.
const (
	// KindConfig is DO → harness: env, mcp.toml, persona, presigned R2 URLs.
	KindConfig = "config"
	// KindStatus is harness → DO: MCP servers that published or were skipped.
	KindStatus = "status"
	// KindPerf is harness → DO: one turn's token use (the "turn perf" slog line).
	KindPerf = "perf"
	// KindLog is harness → DO: a rate-capped slog line.
	KindLog = "log"
	// KindSnapshot is harness → DO: a restore file was PUT to R2.
	KindSnapshot = "snapshot"
)

// LogMinInterval is the default gap between log frames on the socket.
const LogMinInterval = time.Second

// logMessageRunes caps one log frame so a huge slog line cannot fill the socket.
const logMessageRunes = 2000

// ConfigFrame is the boot message from the Agent DO.
// Send it first on the socket, before the harness emits allow or status.
type ConfigFrame struct {
	Kind string `json:"kind"`
	// Env is overlaid on the process environment before stores open.
	// Empty values are ignored so a partial map cannot wipe a key.
	Env map[string]string `json:"env,omitempty"`
	// MCP is the mcp.toml body. Empty means keep the file already on disk.
	MCP string `json:"mcp,omitempty"`
	// Persona is the PERSONA.md body. Empty means keep the file already on disk.
	Persona string `json:"persona,omitempty"`
	// Restore holds presigned GET URLs for gantry.db and SELF.md.
	Restore SnapshotURLs `json:"restore,omitempty"`
	// Put holds presigned PUT URLs. The harness uploads on a timer and on SIGTERM.
	Put SnapshotURLs `json:"put,omitempty"`
}

// SnapshotURLs are presigned R2 URLs. Empty skips that file.
// GET during restore, PUT during publish. Content-Type on PUT is
// application/octet-stream.
type SnapshotURLs struct {
	DB   string `json:"gantry_db,omitempty"`
	Self string `json:"self_md,omitempty"`
}

// StatusFrame lists MCP servers after boot.
type StatusFrame struct {
	Kind      string       `json:"kind"`
	Published []string     `json:"published"`
	Skipped   []SkippedMCP `json:"skipped"`
}

// SkippedMCP is one manifest server that did not publish tools.
// Reason is no_binary, no_key, no_oauth, or connect.
type SkippedMCP struct {
	Name   string `json:"name"`
	Reason string `json:"reason,omitempty"`
}

// PerfFrame is one completed turn. Turn is the session id.
type PerfFrame struct {
	Kind    string     `json:"kind"`
	Turn    string     `json:"turn,omitempty"`
	Source  string     `json:"source,omitempty"`
	Outcome string     `json:"outcome,omitempty"`
	Tokens  PerfTokens `json:"tokens"`
}

// PerfTokens is provider usage for the turn. Zero means the provider omitted it.
type PerfTokens struct {
	Prompt     int `json:"prompt"`
	Completion int `json:"completion"`
}

// LogFrame is one slog record, after the rate cap.
// Dropped counts records refused since the previous log frame.
type LogFrame struct {
	Kind    string `json:"kind"`
	Level   string `json:"level"`
	Message string `json:"message"`
	At      string `json:"at,omitempty"`
	Dropped int    `json:"dropped,omitempty"`
}

// SnapshotFrame confirms a publish. Stamp is UTC YYYYMMDDThhmmssZ. Bytes is the sum uploaded.
type SnapshotFrame struct {
	Kind  string `json:"kind"`
	Stamp string `json:"stamp"`
	Bytes int64  `json:"bytes"`
}

// KindOf reads the kind field. It does not check that the rest of the frame is valid.
func KindOf(raw []byte) (string, error) {
	var probe struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return "", err
	}
	return probe.Kind, nil
}

// EncodeConfig serializes a config frame.
func EncodeConfig(f ConfigFrame) ([]byte, error) {
	f.Kind = KindConfig
	return json.Marshal(f)
}

// DecodeConfig parses a config frame and rejects any other kind.
func DecodeConfig(raw []byte) (ConfigFrame, error) {
	var f ConfigFrame
	if err := json.Unmarshal(raw, &f); err != nil {
		return ConfigFrame{}, err
	}
	if f.Kind != KindConfig {
		return ConfigFrame{}, fmt.Errorf("chat: want kind %s, got %q", KindConfig, f.Kind)
	}
	return f, nil
}

// EncodeStatus serializes a status frame. Nil slices become empty arrays.
func EncodeStatus(f StatusFrame) ([]byte, error) {
	f.Kind = KindStatus
	if f.Published == nil {
		f.Published = []string{}
	}
	if f.Skipped == nil {
		f.Skipped = []SkippedMCP{}
	}
	return json.Marshal(f)
}

// DecodeStatus parses a status frame and rejects any other kind.
func DecodeStatus(raw []byte) (StatusFrame, error) {
	var f StatusFrame
	if err := json.Unmarshal(raw, &f); err != nil {
		return StatusFrame{}, err
	}
	if f.Kind != KindStatus {
		return StatusFrame{}, fmt.Errorf("chat: want kind %s, got %q", KindStatus, f.Kind)
	}
	if f.Published == nil {
		f.Published = []string{}
	}
	if f.Skipped == nil {
		f.Skipped = []SkippedMCP{}
	}
	return f, nil
}

// EncodePerf serializes a perf frame.
func EncodePerf(f PerfFrame) ([]byte, error) {
	f.Kind = KindPerf
	return json.Marshal(f)
}

// DecodePerf parses a perf frame and rejects any other kind.
func DecodePerf(raw []byte) (PerfFrame, error) {
	var f PerfFrame
	if err := json.Unmarshal(raw, &f); err != nil {
		return PerfFrame{}, err
	}
	if f.Kind != KindPerf {
		return PerfFrame{}, fmt.Errorf("chat: want kind %s, got %q", KindPerf, f.Kind)
	}
	return f, nil
}

// EncodeLog serializes a log frame. The message is truncated to logMessageRunes.
func EncodeLog(f LogFrame) ([]byte, error) {
	f.Kind = KindLog
	f.Level = strings.ToLower(strings.TrimSpace(f.Level))
	f.Message = truncateRunes(f.Message, logMessageRunes)
	return json.Marshal(f)
}

// DecodeLog parses a log frame and rejects any other kind.
func DecodeLog(raw []byte) (LogFrame, error) {
	var f LogFrame
	if err := json.Unmarshal(raw, &f); err != nil {
		return LogFrame{}, err
	}
	if f.Kind != KindLog {
		return LogFrame{}, fmt.Errorf("chat: want kind %s, got %q", KindLog, f.Kind)
	}
	return f, nil
}

// EncodeSnapshot serializes a snapshot frame.
func EncodeSnapshot(f SnapshotFrame) ([]byte, error) {
	f.Kind = KindSnapshot
	return json.Marshal(f)
}

// DecodeSnapshot parses a snapshot frame and rejects any other kind.
func DecodeSnapshot(raw []byte) (SnapshotFrame, error) {
	var f SnapshotFrame
	if err := json.Unmarshal(raw, &f); err != nil {
		return SnapshotFrame{}, err
	}
	if f.Kind != KindSnapshot {
		return SnapshotFrame{}, fmt.Errorf("chat: want kind %s, got %q", KindSnapshot, f.Kind)
	}
	return f, nil
}

func truncateRunes(s string, n int) string {
	if n <= 0 || utf8.RuneCountInString(s) <= n {
		return s
	}
	i := 0
	for k := range s {
		if i == n {
			return s[:k]
		}
		i++
	}
	return s
}

// LogLimiter drops log frames that arrive faster than one per Interval.
// A zero Interval uses LogMinInterval. The first call is always allowed.
type LogLimiter struct {
	Interval time.Duration

	mu       sync.Mutex
	last     time.Time
	dropped  int
	interval time.Duration
}

// Allow reports whether a log frame may be sent at now.
// dropped is how many calls were refused since the previous allow.
func (l *LogLimiter) Allow(now time.Time) (ok bool, dropped int) {
	if l == nil {
		return true, 0
	}
	if now.IsZero() {
		now = time.Now()
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.interval == 0 {
		l.interval = l.Interval
		if l.interval <= 0 {
			l.interval = LogMinInterval
		}
	}
	if !l.last.IsZero() && now.Sub(l.last) < l.interval {
		l.dropped++
		return false, 0
	}
	n := l.dropped
	l.dropped = 0
	l.last = now
	return true, n
}
