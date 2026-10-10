package pendant

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/shotah/ai-gantry/internal/channel"
)

func TestDOFrames_RoundTrip(t *testing.T) {
	cfg := ConfigFrame{
		Env:     map[string]string{"LLM_MODEL": "gemini-3.5-flash"},
		MCP:     "[[server]]\nname = \"math\"\n",
		Persona: "be brief\n",
		Restore: SnapshotURLs{DB: "https://r2.example/get-db", Self: "https://r2.example/get-self"},
		Put:     SnapshotURLs{DB: "https://r2.example/put-db", Self: "https://r2.example/put-self"},
	}
	raw, err := EncodeConfig(cfg)
	if err != nil {
		t.Fatal(err)
	}
	got, err := DecodeConfig(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != KindConfig || got.Env["LLM_MODEL"] != "gemini-3.5-flash" || got.MCP != cfg.MCP || got.Persona != cfg.Persona {
		t.Fatalf("%+v", got)
	}
	if got.Restore != cfg.Restore || got.Put != cfg.Put {
		t.Fatalf("urls %+v %+v", got.Restore, got.Put)
	}

	status := StatusFrame{
		Published: []string{"math"},
		Skipped:   []SkippedMCP{{Name: "maps", Reason: "no_key"}},
	}
	raw, err = EncodeStatus(status)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"published":["math"]`) || !strings.Contains(string(raw), `"skipped":[`) {
		t.Fatalf("status json %s", raw)
	}
	st, err := DecodeStatus(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Published) != 1 || st.Published[0] != "math" || st.Skipped[0].Reason != "no_key" {
		t.Fatalf("%+v", st)
	}

	empty, err := EncodeStatus(StatusFrame{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(empty), `"published":[]`) || !strings.Contains(string(empty), `"skipped":[]`) {
		t.Fatalf("empty status %s", empty)
	}

	perf := PerfFrame{Turn: "gantry", Source: "user", Outcome: "ok", Tokens: PerfTokens{Prompt: 10, Completion: 2}}
	raw, err = EncodePerf(perf)
	if err != nil {
		t.Fatal(err)
	}
	pf, err := DecodePerf(raw)
	if err != nil {
		t.Fatal(err)
	}
	if pf.Kind != KindPerf || pf.Turn != "gantry" || pf.Tokens.Prompt != 10 || pf.Tokens.Completion != 2 {
		t.Fatalf("%+v", pf)
	}

	logFrame := LogFrame{Level: "INFO", Message: "hello", At: "2026-10-10T00:00:00Z", Dropped: 3}
	raw, err = EncodeLog(logFrame)
	if err != nil {
		t.Fatal(err)
	}
	lf, err := DecodeLog(raw)
	if err != nil {
		t.Fatal(err)
	}
	if lf.Level != "info" || lf.Message != "hello" || lf.Dropped != 3 {
		t.Fatalf("%+v", lf)
	}

	long := strings.Repeat("x", logMessageRunes+10)
	raw, err = EncodeLog(LogFrame{Level: "warn", Message: long})
	if err != nil {
		t.Fatal(err)
	}
	lf, err = DecodeLog(raw)
	if err != nil {
		t.Fatal(err)
	}
	if utf8.RuneCountInString(lf.Message) != logMessageRunes {
		t.Fatalf("runes %d", utf8.RuneCountInString(lf.Message))
	}

	snap := SnapshotFrame{Stamp: "20261010T160000Z", Bytes: 42}
	raw, err = EncodeSnapshot(snap)
	if err != nil {
		t.Fatal(err)
	}
	sf, err := DecodeSnapshot(raw)
	if err != nil {
		t.Fatal(err)
	}
	if sf.Kind != KindSnapshot || sf.Stamp != snap.Stamp || sf.Bytes != 42 {
		t.Fatalf("%+v", sf)
	}
}

func TestDOFrames_RejectWrongKind(t *testing.T) {
	raw := []byte(`{"kind":"reply","text":"hi"}`)
	if _, err := DecodeConfig(raw); err == nil {
		t.Fatal("config")
	}
	if _, err := DecodeStatus(raw); err == nil {
		t.Fatal("status")
	}
	if _, err := DecodePerf(raw); err == nil {
		t.Fatal("perf")
	}
	if _, err := DecodeLog(raw); err == nil {
		t.Fatal("log")
	}
	if _, err := DecodeSnapshot(raw); err == nil {
		t.Fatal("snapshot")
	}
	if _, err := DecodeConfig([]byte("{")); err == nil {
		t.Fatal("broken")
	}
	kind, err := KindOf([]byte(`{"kind":"allow"}`))
	if err != nil || kind != "allow" {
		t.Fatalf("kind %q %v", kind, err)
	}
}

func TestReplyFrameUnchanged(t *testing.T) {
	raw, err := json.Marshal(outboundFrame{Kind: "reply", Text: "hi", UserID: "1182"})
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	for _, banned := range []string{"gantry_db", "published", "prompt", "dropped", `"stamp"`} {
		if strings.Contains(body, banned) {
			t.Fatalf("reply frame gained %s: %s", banned, body)
		}
	}
	msg, ok, err := InboundTurn([]byte(`{"text":"hi","user_id":"1182"}`))
	if err != nil || !ok || msg.Text != "hi" {
		t.Fatalf("inbound %+v ok=%v err=%v", msg, ok, err)
	}
}

func TestLogLimiter_DropsBurst(t *testing.T) {
	start := time.Date(2026, 10, 10, 16, 0, 0, 0, time.UTC)
	lim := &LogLimiter{Interval: time.Second}
	ok, dropped := lim.Allow(start)
	if !ok || dropped != 0 {
		t.Fatalf("first ok=%v dropped=%d", ok, dropped)
	}
	ok, dropped = lim.Allow(start.Add(10 * time.Millisecond))
	if ok || dropped != 0 {
		t.Fatalf("burst ok=%v dropped=%d", ok, dropped)
	}
	ok, dropped = lim.Allow(start.Add(time.Second))
	if !ok || dropped != 1 {
		t.Fatalf("next ok=%v dropped=%d", ok, dropped)
	}
	ok, _ = (&LogLimiter{}).Allow(time.Time{})
	if !ok {
		t.Fatal("zero limiter")
	}
}

func TestDispatch_ConfigAndDOKindsDoNotStartTurn(t *testing.T) {
	ch, err := New(Config{
		MailboxURL:   "wss://x.workers.dev/ws/kit",
		Bearer:       "tok",
		AllowedUsers: []string{"1182"},
	})
	if err != nil {
		t.Fatal(err)
	}
	var got ConfigFrame
	ch.SetOnConfig(func(f ConfigFrame) { got = f })
	fc := &fakeConn{reads: make(chan []byte), writes: make(chan []byte, 4)}
	called := false
	handle := func(context.Context, channel.Message) (string, error) {
		called = true
		return "", nil
	}
	raw := []byte(`{"kind":"config","persona":"be brief","restore":{"gantry_db":"https://r2.example/db"},"put":{"self_md":"https://r2.example/self"}}`)
	if err := ch.dispatch(context.Background(), fc, raw, handle); err != nil {
		t.Fatal(err)
	}
	if called {
		t.Fatal("config started a turn")
	}
	if got.Persona != "be brief" || got.Restore.DB == "" || got.Put.Self == "" {
		t.Fatalf("%+v", got)
	}
	for _, kind := range []string{KindStatus, KindPerf, KindLog, KindSnapshot} {
		body := []byte(`{"kind":"` + kind + `","message":"x","turn":"gantry"}`)
		if err := ch.dispatch(context.Background(), fc, body, handle); err != nil {
			t.Fatal(err)
		}
		if called {
			t.Fatalf("%s started a turn", kind)
		}
	}
}
