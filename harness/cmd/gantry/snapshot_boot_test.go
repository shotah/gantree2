package main

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gorilla/websocket"

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
	t.Setenv("PENDANT_MAILBOX_URL", "ws"+strings.TrimPrefix(wsSrv.URL, "http")+"/ws/kit")
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
