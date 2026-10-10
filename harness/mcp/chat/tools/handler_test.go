package tools

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"

	"github.com/shotah/pendant-mcp/server"
)

func TestAvatarUpdateFromPath(t *testing.T) {
	root := t.TempDir()
	png := tinyPNG(t, 40, 40)
	path := filepath.Join(root, "face.png")
	if err := os.WriteFile(path, png, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(EnvPendantMailboxURL, "wss://example.workers.dev/ws/kit")
	t.Setenv(EnvPendantBearer, "secret-token")
	t.Setenv(EnvImageOutputDir, root)

	var gotAuth, gotCT, gotURL string
	var gotBody []byte
	old := httpDo
	t.Cleanup(func() { httpDo = old })
	httpDo = func(req *http.Request) (*http.Response, error) {
		gotAuth = req.Header.Get("Authorization")
		gotCT = req.Header.Get("Content-Type")
		gotURL = req.URL.String()
		gotBody, _ = io.ReadAll(req.Body)
		return jsonResponse(200, `{"ok":true,"rev":1725,"detail":"saved face"}`), nil
	}

	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolAvatarUpdate, map[string]any{"source_path": path})
	if isErr {
		t.Fatalf("avatar_update error: %s", text)
	}
	if gotAuth != "Bearer secret-token" {
		t.Fatalf("auth = %q", gotAuth)
	}
	if gotCT != "image/jpeg" {
		t.Fatalf("content-type = %q", gotCT)
	}
	if !strings.Contains(gotURL, "/api/chat/avatar?slug=kit") {
		t.Fatalf("url = %s", gotURL)
	}
	if !isJPEG(gotBody) {
		t.Fatal("posted body is not jpeg")
	}
	if strings.Contains(text, "secret-token") {
		t.Fatal("bearer leaked into result")
	}
	var sum blobWriteResult
	if err := json.Unmarshal([]byte(text), &sum); err != nil {
		t.Fatalf("summary %s: %v", text, err)
	}
	if sum.Rev != 1725 || sum.MIME != "image/jpeg" || sum.Bytes < 1 {
		t.Fatalf("summary = %+v", sum)
	}
}

func TestAvatarUpdateRefusesOutsidePath(t *testing.T) {
	t.Setenv(EnvPendantMailboxURL, "wss://example.workers.dev/ws/kit")
	t.Setenv(EnvPendantBearer, "secret")
	t.Setenv(EnvImageOutputDir, t.TempDir())
	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolAvatarUpdate, map[string]any{"source_path": "/etc/hostname"})
	if !isErr || !strings.Contains(text, "source_path") {
		t.Fatalf("want refuse, got err=%v text=%s", isErr, text)
	}
}

func TestThemeUpdateTeachIn(t *testing.T) {
	t.Setenv(EnvPendantMailboxURL, "wss://example.workers.dev/ws/kit")
	t.Setenv(EnvPendantBearer, "secret")
	posts := 0
	old := httpDo
	t.Cleanup(func() { httpDo = old })
	httpDo = func(req *http.Request) (*http.Response, error) {
		if req.Method == http.MethodPost {
			posts++
		}
		if req.Method != http.MethodGet {
			t.Fatalf("unlisted theme must not POST, got %s", req.Method)
		}
		return jsonResponse(200, `{"theme":"boom","themes":[{"id":"siren","label":"Siren","feel":"angry","scheme":"dark","mood":"angry, dark — siren at night: black red, scarlet","canvas":"#160608","accent":"#ff2e3f"}]}`), nil
	}
	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolThemeUpdate, map[string]any{"theme": "#ff00ff"})
	if !isErr || !strings.Contains(text, "theme_list") {
		t.Fatalf("want theme_list teach-in, got err=%v text=%s", isErr, text)
	}
	if posts != 0 {
		t.Fatalf("posts = %d, want 0", posts)
	}
	text, isErr = callTool(t, s, ToolThemeUpdate, map[string]any{})
	if !isErr || !strings.Contains(text, "theme_list") {
		t.Fatalf("want empty teach-in, got err=%v text=%s", isErr, text)
	}
	text, isErr = callTool(t, s, ToolThemeUpdate, map[string]any{"theme": "noir"})
	if !isErr || !strings.Contains(text, "theme_list") {
		t.Fatalf("want retired id refused, got err=%v text=%s", isErr, text)
	}
	if posts != 0 {
		t.Fatalf("posts = %d, want 0", posts)
	}
}

func TestThemeListAndUpdate(t *testing.T) {
	t.Setenv(EnvPendantMailboxURL, "wss://example.workers.dev/ws/kit")
	t.Setenv(EnvPendantBearer, "secret")
	gets, posts := 0, 0
	old := httpDo
	t.Cleanup(func() { httpDo = old })
	httpDo = func(req *http.Request) (*http.Response, error) {
		if req.Method == http.MethodGet {
			gets++
			return jsonResponse(200, `{"theme":"boom","themes":[{"id":"siren","label":"Siren","feel":"angry","scheme":"dark","mood":"angry, dark — siren at night: black red, scarlet","canvas":"#160608","accent":"#ff2e3f"}]}`), nil
		}
		posts++
		body, _ := io.ReadAll(req.Body)
		if !strings.Contains(string(body), `"siren"`) {
			t.Fatalf("body = %s", body)
		}
		return jsonResponse(200, `{"ok":true,"theme":"siren","detail":"theme siren"}`), nil
	}
	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolThemeList, map[string]any{})
	if isErr || !strings.Contains(text, "siren at night") || !strings.Contains(text, `"feel":"angry"`) {
		t.Fatalf("theme_list err=%v text=%s", isErr, text)
	}
	text, isErr = callTool(t, s, ToolThemeUpdate, map[string]any{"theme": "siren"})
	if isErr || !strings.Contains(text, `"theme":"siren"`) {
		t.Fatalf("theme_update err=%v text=%s", isErr, text)
	}
	if gets != 1 || posts != 1 {
		t.Fatalf("gets=%d posts=%d, want 1 GET (cached into update) and 1 POST", gets, posts)
	}
}

func TestThemeUpdateAcceptsListedPaper(t *testing.T) {
	t.Setenv(EnvPendantMailboxURL, "wss://example.workers.dev/ws/kit")
	t.Setenv(EnvPendantBearer, "secret")
	old := httpDo
	t.Cleanup(func() { httpDo = old })
	httpDo = func(req *http.Request) (*http.Response, error) {
		if req.Method == http.MethodGet {
			return jsonResponse(200, `{"theme":null,"themes":[{"id":"paper","label":"Paper","feel":"neutral","scheme":"light","mood":"neutral, light — day workshop","canvas":"#f6f1e8","accent":"#c24a28"}]}`), nil
		}
		body, _ := io.ReadAll(req.Body)
		if req.Method != http.MethodPost || !strings.Contains(string(body), `"paper"`) {
			t.Fatalf("method=%s body=%s", req.Method, body)
		}
		return jsonResponse(200, `{"ok":true,"theme":"paper"}`), nil
	}
	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolThemeUpdate, map[string]any{"theme": "paper"})
	if isErr || !strings.Contains(text, `"theme":"paper"`) {
		t.Fatalf("theme_update paper err=%v text=%s", isErr, text)
	}
}

func TestThemeUpdateClearsCacheWhenWorkerRejects(t *testing.T) {
	t.Setenv(EnvPendantMailboxURL, "wss://example.workers.dev/ws/kit")
	t.Setenv(EnvPendantBearer, "secret")
	gets, posts := 0, 0
	old := httpDo
	t.Cleanup(func() { httpDo = old })
	httpDo = func(req *http.Request) (*http.Response, error) {
		if req.Method == http.MethodGet {
			gets++
			return jsonResponse(200, `{"theme":null,"themes":[{"id":"siren","label":"Siren","feel":"angry","scheme":"dark","mood":"angry, dark — siren at night: black red, scarlet","canvas":"#160608","accent":"#ff2e3f"}]}`), nil
		}
		posts++
		return jsonResponse(400, `{"error":"bad theme"}`), nil
	}
	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolThemeUpdate, map[string]any{"theme": "siren"})
	if !isErr || !strings.Contains(text, "bad theme") {
		t.Fatalf("want worker reject, got err=%v text=%s", isErr, text)
	}
	text, isErr = callTool(t, s, ToolThemeUpdate, map[string]any{"theme": "siren"})
	if !isErr || !strings.Contains(text, "bad theme") {
		t.Fatalf("want second reject, got err=%v text=%s", isErr, text)
	}
	if gets != 2 || posts != 2 {
		t.Fatalf("gets=%d posts=%d, want 2 each after cache drop", gets, posts)
	}
}

func TestThemeDelete(t *testing.T) {
	t.Setenv(EnvPendantMailboxURL, "wss://example.workers.dev/ws/kit")
	t.Setenv(EnvPendantBearer, "secret")
	old := httpDo
	t.Cleanup(func() { httpDo = old })
	httpDo = func(*http.Request) (*http.Response, error) {
		return jsonResponse(200, `{"ok":true,"theme":null,"detail":"cleared theme"}`), nil
	}
	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolThemeDelete, map[string]any{})
	if isErr || !strings.Contains(text, "cleared") {
		t.Fatalf("theme_delete err=%v text=%s", isErr, text)
	}
}

func TestBackdropDelete(t *testing.T) {
	t.Setenv(EnvPendantMailboxURL, "wss://example.workers.dev/ws/kit")
	t.Setenv(EnvPendantBearer, "secret")
	old := httpDo
	t.Cleanup(func() { httpDo = old })
	httpDo = func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodDelete || !strings.Contains(req.URL.Path, "/api/chat/backdrop") {
			t.Fatalf("method=%s url=%s", req.Method, req.URL)
		}
		return jsonResponse(200, `{"ok":true,"rev":0,"detail":"cleared backdrop"}`), nil
	}
	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolBackdropDelete, map[string]any{})
	if isErr {
		t.Fatalf("backdrop_delete error: %s", text)
	}
	var sum blobWriteResult
	if err := json.Unmarshal([]byte(text), &sum); err != nil || sum.Rev != 0 {
		t.Fatalf("summary = %s err=%v", text, err)
	}
}

func TestAvatarGetWritesFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv(EnvPendantMailboxURL, "wss://example.workers.dev/ws/kit")
	t.Setenv(EnvPendantBearer, "secret")
	t.Setenv(EnvImageOutputDir, dir)
	jpeg := tinyJPEG(t)
	old := httpDo
	t.Cleanup(func() { httpDo = old })
	httpDo = func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"X-Pendant-Rev": []string{"9"}, "Content-Type": []string{"image/jpeg"}},
			Body:       io.NopCloser(strings.NewReader(string(jpeg))),
		}, nil
	}
	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolAvatarGet, map[string]any{})
	if isErr {
		t.Fatalf("avatar_get error: %s", text)
	}
	var sum blobWriteResult
	if err := json.Unmarshal([]byte(text), &sum); err != nil || sum.Rev != 9 || sum.Path == "" {
		t.Fatalf("summary = %s err=%v", text, err)
	}
	if _, err := os.Stat(sum.Path); err != nil {
		t.Fatal(err)
	}
}

func TestWorkerErrorVerbatim(t *testing.T) {
	t.Setenv(EnvPendantMailboxURL, "wss://example.workers.dev/ws/kit")
	t.Setenv(EnvPendantBearer, "secret")
	t.Setenv(EnvImageOutputDir, t.TempDir())
	png := tinyPNG(t, 16, 16)
	path := filepath.Join(os.Getenv(EnvImageOutputDir), "x.png")
	if err := os.WriteFile(path, png, 0o600); err != nil {
		t.Fatal(err)
	}
	old := httpDo
	t.Cleanup(func() { httpDo = old })
	httpDo = func(*http.Request) (*http.Response, error) {
		return jsonResponse(429, `{"error":"rate"}`), nil
	}
	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolBackdropUpdate, map[string]any{"source_path": path})
	if !isErr || text != "rate" {
		t.Fatalf("want verbatim rate, got err=%v text=%s", isErr, text)
	}
}

func TestAvatarUpdateFromBase64(t *testing.T) {
	t.Setenv(EnvPendantMailboxURL, "wss://example.workers.dev/ws/kit")
	t.Setenv(EnvPendantBearer, "secret")
	old := httpDo
	t.Cleanup(func() { httpDo = old })
	httpDo = func(*http.Request) (*http.Response, error) {
		return jsonResponse(200, `{"ok":true,"rev":1}`), nil
	}
	s := newToolServer(t)
	b64 := base64.StdEncoding.EncodeToString(tinyPNG(t, 24, 24))
	text, isErr := callTool(t, s, ToolBackdropUpdate, map[string]any{"source_image": b64})
	if isErr {
		t.Fatalf("backdrop_update error: %s", text)
	}
}

func TestMissingMailboxTeachIn(t *testing.T) {
	t.Setenv(EnvPendantMailboxURL, "")
	t.Setenv(EnvPendantBearer, "")
	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolThemeList, map[string]any{})
	if !isErr || !strings.Contains(text, EnvChatMailboxURL) {
		t.Fatalf("want mailbox teach-in, got err=%v text=%s", isErr, text)
	}
}

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func newToolServer(t *testing.T) *mcpserver.MCPServer {
	t.Helper()
	resetThemeCatalogCache()
	s := server.New()
	Register(s)
	return s
}

func callTool(t *testing.T, s *mcpserver.MCPServer, toolName string, args map[string]any) (text string, isError bool) {
	t.Helper()
	params := map[string]any{"name": toolName, "arguments": args}
	msg := map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params}
	raw, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	resp := s.HandleMessage(context.Background(), raw)
	switch r := resp.(type) {
	case mcp.JSONRPCResponse:
		result, ok := r.Result.(*mcp.CallToolResult)
		if !ok {
			t.Fatalf("expected *CallToolResult, got %T", r.Result)
		}
		if len(result.Content) == 0 {
			return "", result.IsError
		}
		tc, ok := result.Content[0].(mcp.TextContent)
		if !ok {
			t.Fatalf("expected TextContent, got %T", result.Content[0])
		}
		return tc.Text, result.IsError
	case mcp.JSONRPCError:
		t.Fatalf("protocol error %d: %s", r.Error.Code, r.Error.Message)
		return "", true
	default:
		t.Fatalf("unexpected response type %T", resp)
		return "", true
	}
}
