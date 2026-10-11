package chat

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/shotah/ai-gantry/internal/channel"
)

func TestLogBridge_PerfAndRateCap(t *testing.T) {
	var buf bytes.Buffer
	next := slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	bridge := NewLogBridge(next, time.Hour)
	var got []string
	logger := slog.New(bridge)
	logger.Info("boot line")
	logger.Info("turn perf",
		"session_id", "gantry",
		"source", "user",
		"outcome", "ok",
		"prompt_tokens", 11,
		"completion_tokens", 4,
	)
	logger.Info("second line")
	bridge.SetSend(func(raw []byte) {
		got = append(got, string(raw))
	})
	if len(got) != 2 {
		t.Fatalf("frames %d: %v", len(got), got)
	}
	var logs, perfs int
	for _, raw := range got {
		kind, err := KindOf([]byte(raw))
		if err != nil {
			t.Fatal(err)
		}
		switch kind {
		case KindLog:
			logs++
			lf, err := DecodeLog([]byte(raw))
			if err != nil {
				t.Fatal(err)
			}
			if lf.Message != "boot line" || lf.Level != "info" {
				t.Fatalf("log %+v", lf)
			}
		case KindPerf:
			perfs++
			pf, err := DecodePerf([]byte(raw))
			if err != nil {
				t.Fatal(err)
			}
			if pf.Turn != "gantry" || pf.Source != "user" || pf.Outcome != "ok" || pf.Tokens.Prompt != 11 || pf.Tokens.Completion != 4 {
				t.Fatalf("perf %+v", pf)
			}
		default:
			t.Fatalf("kind %s", kind)
		}
	}
	if logs != 1 || perfs != 1 {
		t.Fatalf("logs=%d perfs=%d", logs, perfs)
	}
	if !strings.Contains(buf.String(), "turn perf") || !strings.Contains(buf.String(), "boot line") {
		t.Fatalf("next handler missed records: %s", buf.String())
	}

	bridge.SetSend(func(raw []byte) {
		got = append(got, string(raw))
	})
	logger.Info("after attach")
	if len(got) != 2 {
		t.Fatalf("rate cap let a second log through: %d", len(got))
	}
}

func TestLogBridge_ErrorLaneAndAttrs(t *testing.T) {
	bridge := NewLogBridge(slog.NewJSONHandler(io.Discard, nil), time.Hour)
	logger := slog.New(bridge)
	logger.Info("gantry starting", "version", "dev")
	logger.Info("squeezed out")
	logger.Error("snapshot restore failed", "err", "mkdir /etc/gantry: permission denied", "n", 2)
	logger.Error("second error squeezed")

	var got []LogFrame
	bridge.SetSend(func(raw []byte) {
		lf, err := DecodeLog(raw)
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, lf)
	})
	if len(got) != 2 {
		t.Fatalf("frames %d: %+v", len(got), got)
	}
	if got[0].Message != "gantry starting version=dev" || got[0].Level != "info" {
		t.Fatalf("info %+v", got[0])
	}
	want := `snapshot restore failed err="mkdir /etc/gantry: permission denied" n=2`
	if got[1].Message != want || got[1].Level != "error" {
		t.Fatalf("error %+v", got[1])
	}
}

type flushSock struct {
	frames [][]byte
	closed bool
}

func (s *flushSock) ReadMessage() (int, []byte, error) { return 0, nil, io.EOF }
func (s *flushSock) WriteMessage(_ int, data []byte) error {
	s.frames = append(s.frames, append([]byte(nil), data...))
	return nil
}
func (s *flushSock) Close() error { s.closed = true; return nil }

func TestLogBridge_FlushWritesQueueThenDetaches(t *testing.T) {
	bridge := NewLogBridge(slog.NewJSONHandler(io.Discard, nil), time.Hour)
	logger := slog.New(bridge)
	logger.Error("boot died", "err", "x")
	sock := &flushSock{}
	bridge.Flush(sock)
	if len(sock.frames) != 1 || !strings.Contains(string(sock.frames[0]), `boot died err=x`) {
		t.Fatalf("frames %q", sock.frames)
	}
	if sock.closed {
		t.Fatal("flush must not close; the caller owns the socket")
	}
	logger.Error("after flush")
	if len(sock.frames) != 1 {
		t.Fatalf("sender still attached: %q", sock.frames)
	}
	bridge.Flush(nil)
	var nilBridge *LogBridge
	nilBridge.Flush(sock)
}

func TestLogBridge_WithAttrsSharesSend(t *testing.T) {
	bridge := NewLogBridge(slog.NewJSONHandler(io.Discard, nil), time.Hour)
	child := bridge.WithAttrs([]slog.Attr{slog.String("k", "v")})
	logger := slog.New(child)
	logger.Info("child")
	var n int
	bridge.SetSend(func([]byte) { n++ })
	if n != 1 {
		t.Fatalf("flushed %d", n)
	}
	if bridge.WithGroup("") != bridge {
		t.Fatal("empty group")
	}
	if bridge.WithAttrs(nil) != bridge {
		t.Fatal("empty attrs")
	}
}

func TestSendDO_LiveThenDial(t *testing.T) {
	ch, err := New(Config{
		MailboxURL:   "wss://x.workers.dev/ws/kit",
		Bearer:       "tok",
		AllowedUsers: []string{"1182"},
	})
	if err != nil {
		t.Fatal(err)
	}
	fc := &fakeConn{reads: make(chan []byte), writes: make(chan []byte, 2)}
	ch.setLive(fc)
	raw := []byte(`{"kind":"snapshot","stamp":"t","bytes":3}`)
	if err := ch.SendDO(context.Background(), raw); err != nil {
		t.Fatal(err)
	}
	got := <-fc.writes
	if string(got) != string(raw) {
		t.Fatalf("wrote %s", got)
	}
	if err := ch.SendDO(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
}

func TestServe_EmitsStatusWhenSet(t *testing.T) {
	ch, err := New(Config{
		MailboxURL:   "wss://x.workers.dev/ws/kit",
		Bearer:       "tok",
		AllowedUsers: []string{"1182"},
	})
	if err != nil {
		t.Fatal(err)
	}
	ch.SetStatus(func() StatusFrame {
		return StatusFrame{Published: []string{"math"}, Skipped: []SkippedMCP{{Name: "maps", Reason: "no_key"}}}
	})
	fc := &fakeConn{reads: make(chan []byte), writes: make(chan []byte, 8)}
	ch.Adopt(fc)
	done := make(chan error, 1)
	go func() {
		done <- ch.serve(context.Background(), func(context.Context, channel.Message) (string, error) {
			return "", nil
		})
	}()
	deadline := time.After(2 * time.Second)
	saw := false
	for !saw {
		select {
		case raw := <-fc.writes:
			kind, err := KindOf(raw)
			if err != nil {
				t.Fatal(err)
			}
			if kind != KindStatus {
				continue
			}
			st, err := DecodeStatus(raw)
			if err != nil {
				t.Fatal(err)
			}
			if len(st.Published) != 1 || st.Published[0] != "math" || st.Skipped[0].Name != "maps" || st.Skipped[0].Reason != "no_key" {
				t.Fatalf("%+v", st)
			}
			saw = true
		case <-deadline:
			t.Fatal("no status frame")
		}
	}
	fc.Close()
	<-done
}
