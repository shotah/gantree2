package tools

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
	"github.com/shotah/image-generation-mcp/server"
)

type stubProvider struct {
	res  Result
	err  error
	last Request
}

func (s *stubProvider) Generate(_ context.Context, req Request) (Result, error) {
	s.last = req
	return s.res, s.err
}

func TestMCPCallGenerate(t *testing.T) {
	png := []byte{0x89, 0x50, 0x4e, 0x47}
	stub := &stubProvider{res: Result{MIME: mimePNG, Data: png, Model: "gemini-3.1-flash-image", Note: "ok"}}
	old := newProvider
	t.Cleanup(func() { newProvider = old })
	newProvider = func() (Provider, error) { return stub, nil }

	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolGenerate, map[string]any{
		"prompt":       "a red bicycle",
		"aspect_ratio": "16:9",
	})
	if isErr {
		t.Fatalf("photo_generate error: %s", text)
	}
	var sum Summary
	if err := json.Unmarshal([]byte(text), &sum); err != nil {
		t.Fatalf("summary %s: %v", text, err)
	}
	if sum.Prompt != "a red bicycle" || sum.Bytes != len(png) || sum.MIME != mimePNG {
		t.Fatalf("summary = %+v", sum)
	}
	if stub.last.AspectRatio != "16:9" {
		t.Fatalf("aspect = %q", stub.last.AspectRatio)
	}
}

func TestMCPCallGenerateMissingPrompt(t *testing.T) {
	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolGenerate, map[string]any{})
	if !isErr || !strings.Contains(text, "prompt") {
		t.Fatalf("expected prompt teach-in, got err=%v text=%s", isErr, text)
	}
}

func TestMCPCallGenerateMissingKey(t *testing.T) {
	t.Setenv(EnvImageAPIKey, "")
	t.Setenv(EnvLLMAPIKey, "")
	t.Setenv(EnvGoogleGenAIUseVertexAI, "")
	old := newProvider
	t.Cleanup(func() { newProvider = old })
	newProvider = providerFromEnv

	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolGenerate, map[string]any{"prompt": "cat"})
	if !isErr || !strings.Contains(text, EnvImageAPIKey) {
		t.Fatalf("expected missing-key teach-in, got err=%v text=%s", isErr, text)
	}
}

func TestMCPCallGenerateWritesPath(t *testing.T) {
	dir := t.TempDir()
	t.Setenv(EnvImageOutputDir, dir)
	png := []byte{0x89, 0x50, 0x4e, 0x47}
	stub := &stubProvider{res: Result{MIME: mimePNG, Data: png, Model: DefaultModel}}
	old := newProvider
	t.Cleanup(func() { newProvider = old })
	newProvider = func() (Provider, error) { return stub, nil }

	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolGenerate, map[string]any{"prompt": "batman portrait", "aspect_ratio": "1:1"})
	if isErr {
		t.Fatalf("photo_generate error: %s", text)
	}
	var sum Summary
	if err := json.Unmarshal([]byte(text), &sum); err != nil {
		t.Fatalf("summary %s: %v", text, err)
	}
	if sum.Path == "" || !strings.HasPrefix(sum.Path, dir) {
		t.Fatalf("want path under %s, got %+v", dir, sum)
	}
}

func TestMCPCallEditFromPath(t *testing.T) {
	root := t.TempDir()
	t.Setenv(EnvImageOutputDir, root)
	src := []byte{0x89, 0x50, 0x4e, 0x47}
	path := filepath.Join(root, "face.png")
	if err := os.WriteFile(path, src, 0o600); err != nil {
		t.Fatal(err)
	}
	png := []byte{0x89, 0x50}
	stub := &stubProvider{res: Result{MIME: mimePNG, Data: png, Model: DefaultModel}}
	old := newProvider
	t.Cleanup(func() { newProvider = old })
	newProvider = func() (Provider, error) { return stub, nil }

	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolEdit, map[string]any{
		"prompt":      "add a hat",
		"source_path": path,
	})
	if isErr {
		t.Fatalf("photo_edit error: %s", text)
	}
	if !bytes.Equal(stub.last.SourceData, src) {
		t.Fatalf("source = %v", stub.last.SourceData)
	}
	if stub.last.SourceMIME != mimePNG {
		t.Fatalf("mime = %q", stub.last.SourceMIME)
	}
}

func TestMCPCallEditRefusesOutsidePath(t *testing.T) {
	t.Setenv(EnvImageOutputDir, t.TempDir())
	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolEdit, map[string]any{
		"prompt":      "add a hat",
		"source_path": "/etc/hostname",
	})
	if !isErr || !strings.Contains(text, "source_path") {
		t.Fatalf("want refuse, got err=%v text=%s", isErr, text)
	}
}

func TestMCPCallEdit(t *testing.T) {
	png := []byte{0x89, 0x50}
	src := []byte{0x01, 0x02}
	stub := &stubProvider{res: Result{MIME: mimePNG, Data: png, Model: DefaultModel}}
	old := newProvider
	t.Cleanup(func() { newProvider = old })
	newProvider = func() (Provider, error) { return stub, nil }

	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolEdit, map[string]any{
		"prompt":       "watercolor",
		"source_image": base64.StdEncoding.EncodeToString(src),
	})
	if isErr {
		t.Fatalf("photo_edit error: %s", text)
	}
	if !bytes.Equal(stub.last.SourceData, src) {
		t.Fatalf("source = %v", stub.last.SourceData)
	}
	if !strings.Contains(text, `"bytes":2`) {
		t.Fatalf("payload = %s", text)
	}
}

func TestValidateAspectSize(t *testing.T) {
	t.Parallel()
	if err := validateAspectSize(Request{AspectRatio: "7:5"}); err == nil {
		t.Fatal("want aspect error")
	}
	if err := validateAspectSize(Request{Size: "8K"}); err == nil {
		t.Fatal("want size error")
	}
	if err := validateAspectSize(Request{AspectRatio: "1:1", Size: "1K"}); err != nil {
		t.Fatal(err)
	}
}

func newToolServer(t *testing.T) *mcpserver.MCPServer {
	t.Helper()
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
