package main

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/shotah/ai-gantry/internal/channel/chat"
	"github.com/shotah/ai-gantry/internal/config"
	"github.com/shotah/ai-gantry/internal/snapshot"
)

func TestPrepareSnapshot_RestoresFromConfigFrame(t *testing.T) {
	files := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/db":
			if r.Method == http.MethodPut {
				body, _ := io.ReadAll(r.Body)
				if string(body) != "db-bytes" {
					t.Errorf("put db %q", body)
				}
				w.WriteHeader(http.StatusNoContent)
				return
			}
			_, _ = io.WriteString(w, "db-bytes")
		case "/self":
			if r.Method == http.MethodPut {
				w.WriteHeader(http.StatusOK)
				return
			}
			_, _ = io.WriteString(w, "- from r2\n")
		default:
			http.NotFound(w, r)
		}
	}))
	defer files.Close()

	up := websocket.Upgrader{}
	wsSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			http.Error(w, "no", http.StatusUnauthorized)
			return
		}
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		frame := `{
			"kind":"config",
			"env":{"LLM_MODEL":"from-frame"},
			"mcp":"[[server]]\nname = \"math\"\n",
			"persona":"be brief\n",
			"restore":{"gantry_db":"` + files.URL + `/db","self_md":"` + files.URL + `/self"},
			"put":{"gantry_db":"` + files.URL + `/db","self_md":"` + files.URL + `/self"}
		}`
		_ = c.WriteMessage(websocket.TextMessage, []byte(frame))
	}))
	defer wsSrv.Close()

	data := t.TempDir()
	persona := t.TempDir()
	manifest := filepath.Join(t.TempDir(), "mcp.toml")
	t.Setenv("LLM_BASE_URL", "https://example.com/v1")
	t.Setenv("LLM_API_KEY", "test-key")
	t.Setenv("LLM_MODEL", "test-model")
	t.Setenv("CHANNEL", "pendant")
	t.Setenv("CHAT_MAILBOX_URL", "ws"+strings.TrimPrefix(wsSrv.URL, "http")+"/ws/kit")
	t.Setenv("PENDANT_BEARER", "tok")
	t.Setenv("PENDANT_ALLOWED_USERS", "1182")
	t.Setenv("DATA_DIR", data)
	t.Setenv("PERSONA_DIR", persona)
	t.Setenv("MCP_MANIFEST", manifest)
	t.Setenv("SNAPSHOT", "true")

	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	boot, err := prepareSnapshot(cfg, logger)
	if err != nil {
		t.Fatal(err)
	}
	if boot == nil || boot.sock == nil || boot.snap == nil {
		t.Fatalf("boot %+v", boot)
	}
	defer boot.sock.Close()
	if cfg.LLMModel != "from-frame" {
		t.Fatalf("model %q", cfg.LLMModel)
	}
	if cfg.Snapshot != true {
		t.Fatal("snapshot flag cleared")
	}
	db, err := os.ReadFile(filepath.Join(data, snapshot.DBFile))
	if err != nil || string(db) != "db-bytes" {
		t.Fatalf("db %q %v", db, err)
	}
	self, err := os.ReadFile(filepath.Join(persona, snapshot.SelfFile))
	if err != nil || string(self) != "- from r2\n" {
		t.Fatalf("self %q %v", self, err)
	}
	personaBody, err := os.ReadFile(filepath.Join(persona, "PERSONA.md"))
	if err != nil || string(personaBody) != "be brief\n" {
		t.Fatalf("persona %q %v", personaBody, err)
	}
	mcpBody, err := os.ReadFile(manifest)
	if err != nil || !strings.Contains(string(mcpBody), "math") {
		t.Fatalf("mcp %q %v", mcpBody, err)
	}

	res, err := boot.snap.Publish(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Files != 2 || res.Bytes == 0 || res.Stamp == "" {
		t.Fatalf("%+v", res)
	}
	f := statusFrame(nil)
	if f.Kind != "status" || len(f.Published) != 0 || len(f.Skipped) != 0 {
		t.Fatalf("%+v", f)
	}
}

func TestPrepareSnapshot_StdioUsesEnvURLs(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "only-db")
	}))
	defer srv.Close()
	data := t.TempDir()
	cfg := &config.Config{
		Channel:       config.ChannelStdio,
		DataDir:       data,
		PersonaDir:    data,
		Snapshot:      true,
		SnapshotGetDB: srv.URL + "/db",
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	boot, err := prepareSnapshot(cfg, logger)
	if err != nil {
		t.Fatal(err)
	}
	if boot.sock != nil {
		t.Fatal("stdio dialed")
	}
	body, err := os.ReadFile(filepath.Join(data, "gantry.db"))
	if err != nil || string(body) != "only-db" {
		t.Fatalf("%q %v", body, err)
	}
	emitSnapshot(logger, boot.snap, nil)
}

func tokenTar(t *testing.T, name, body string) []byte {
	t.Helper()
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	raw := []byte(body)
	hdr := &tar.Header{
		Name:     name,
		Mode:     0o600,
		Size:     int64(len(raw)),
		Typeflag: tar.TypeReg,
		ModTime:  time.Unix(0, 0).UTC(),
	}
	if err := tw.WriteHeader(hdr); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestPrepareSnapshot_StdioRestoresTokens(t *testing.T) {
	key := bytes.Repeat([]byte{6}, 32)
	secret := "refresh-secret"
	blob, err := snapshot.EncryptTokens(key, tokenTar(t, ".strava/tokens.json", secret))
	if err != nil {
		t.Fatal(err)
	}
	var put []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/tokens" {
			http.NotFound(w, r)
			return
		}
		if r.Method == http.MethodPut {
			put, _ = io.ReadAll(r.Body)
			if bytes.Contains(put, []byte(secret)) {
				t.Errorf("plaintext uploaded")
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		_, _ = w.Write(blob)
	}))
	defer srv.Close()

	data := t.TempDir()
	cfg := &config.Config{
		Channel:           config.ChannelStdio,
		DataDir:           data,
		PersonaDir:        data,
		Snapshot:          true,
		SnapshotGetTokens: srv.URL + "/tokens",
		SnapshotPutTokens: srv.URL + "/tokens",
		SnapshotKey:       base64.StdEncoding.EncodeToString(key),
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	boot, err := prepareSnapshot(cfg, logger)
	if err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(data, ".strava", "tokens.json"))
	if err != nil || string(body) != secret {
		t.Fatalf("%q %v", body, err)
	}
	res, err := boot.snap.Publish(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Files != 1 || len(put) == 0 || bytes.Contains(put, []byte(secret)) {
		t.Fatalf("%+v put=%d", res, len(put))
	}
	opened, err := snapshot.DecryptTokens(key, put)
	if err != nil || !bytes.Contains(opened, []byte(secret)) {
		t.Fatalf("decrypt %v", err)
	}
}

func TestPrepareSnapshot_NoKeySkipsTokenURL(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	data := t.TempDir()
	if err := os.MkdirAll(filepath.Join(data, ".strava"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(data, ".strava", "tokens.json"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{
		Channel:           config.ChannelStdio,
		DataDir:           data,
		PersonaDir:        data,
		Snapshot:          true,
		SnapshotGetTokens: srv.URL + "/tokens",
		SnapshotPutTokens: srv.URL + "/tokens",
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	boot, err := prepareSnapshot(cfg, logger)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := boot.snap.Publish(context.Background()); err != nil {
		t.Fatal(err)
	}
	if hits != 0 {
		t.Fatalf("hits %d", hits)
	}
}

func TestPrepareSnapshot_FrameRestoresEncryptedTokens(t *testing.T) {
	key := bytes.Repeat([]byte{3}, 32)
	b64 := base64.StdEncoding.EncodeToString(key)
	secret := "frame-refresh"
	blob, err := snapshot.EncryptTokens(key, tokenTar(t, ".config/garmin/session.json", secret))
	if err != nil {
		t.Fatal(err)
	}
	var put []byte
	files := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/tokens" {
			http.NotFound(w, r)
			return
		}
		if r.Method == http.MethodPut {
			put, _ = io.ReadAll(r.Body)
			if bytes.Contains(put, []byte(secret)) {
				t.Errorf("plaintext uploaded")
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		_, _ = w.Write(blob)
	}))
	defer files.Close()

	raw, err := chat.EncodeConfig(chat.ConfigFrame{
		Env: map[string]string{
			"LLM_MODEL":    "from-frame",
			"SNAPSHOT_KEY": b64,
		},
		Restore: chat.SnapshotURLs{Tokens: files.URL + "/tokens"},
		Put:     chat.SnapshotURLs{Tokens: files.URL + "/tokens"},
	})
	if err != nil {
		t.Fatal(err)
	}

	up := websocket.Upgrader{}
	wsSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			http.Error(w, "no", http.StatusUnauthorized)
			return
		}
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		_ = c.WriteMessage(websocket.TextMessage, raw)
	}))
	defer wsSrv.Close()

	data := t.TempDir()
	persona := t.TempDir()
	manifest := filepath.Join(t.TempDir(), "mcp.toml")
	t.Setenv("LLM_BASE_URL", "https://example.com/v1")
	t.Setenv("LLM_API_KEY", "test-key")
	t.Setenv("LLM_MODEL", "test-model")
	t.Setenv("CHANNEL", "pendant")
	t.Setenv("CHAT_MAILBOX_URL", "ws"+strings.TrimPrefix(wsSrv.URL, "http")+"/ws/kit")
	t.Setenv("PENDANT_BEARER", "tok")
	t.Setenv("PENDANT_ALLOWED_USERS", "1182")
	t.Setenv("DATA_DIR", data)
	t.Setenv("PERSONA_DIR", persona)
	t.Setenv("MCP_MANIFEST", manifest)
	t.Setenv("SNAPSHOT", "true")

	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	boot, err := prepareSnapshot(cfg, logger)
	if err != nil {
		t.Fatal(err)
	}
	if boot == nil || boot.sock == nil {
		t.Fatal("boot")
	}
	defer boot.sock.Close()
	if cfg.SnapshotKey != b64 {
		t.Fatal("key not applied from frame")
	}
	body, err := os.ReadFile(filepath.Join(data, ".config", "garmin", "session.json"))
	if err != nil || string(body) != secret {
		t.Fatalf("%q %v", body, err)
	}
	res, err := boot.snap.Publish(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Files != 1 || len(put) == 0 || bytes.Contains(put, []byte(secret)) {
		t.Fatalf("%+v put=%d", res, len(put))
	}
}
