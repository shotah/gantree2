package tools

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"

	"github.com/shotah/pendant-mcp/server"
)

func TestToolNamesLocked(t *testing.T) {
	t.Parallel()
	re := regexp.MustCompile(`^[a-z]+_[a-z]+`)
	names := ToolNames()
	if len(names) != 7 {
		t.Fatalf("ToolNames() len = %d, want 7: %v", len(names), names)
	}
	want := map[string]bool{
		"avatar_update":   true,
		"avatar_get":      true,
		"backdrop_update": true,
		"backdrop_delete": true,
		"theme_list":      true,
		"theme_update":    true,
		"theme_delete":    true,
	}
	for _, name := range names {
		if !re.MatchString(name) {
			t.Errorf("tool %q does not match ^[a-z]+_[a-z]+", name)
		}
		if strings.HasPrefix(name, "chat") || strings.HasPrefix(name, "pendant") {
			t.Errorf("tool %q starts with server id chat (or the old pendant id)", name)
		}
		if !want[name] {
			t.Errorf("unexpected tool %q", name)
		}
		delete(want, name)
	}
	for missing := range want {
		t.Errorf("missing tool %q", missing)
	}
}

func TestRegisteredToolNamesMatchCatalog(t *testing.T) {
	t.Parallel()
	s := server.New()
	Register(s)
	got := registeredToolNames(t, s)
	want := ToolNames()
	if len(got) != len(want) {
		t.Fatalf("registered %d tools %v, catalog %v", len(got), keys(got), want)
	}
	for _, name := range want {
		if !got[name] {
			t.Errorf("catalog tool %q is not registered", name)
		}
	}
}

func TestRegisteredToolsDoNotNameCatalogCards(t *testing.T) {
	t.Parallel()
	s := server.New()
	Register(s)
	for _, tool := range registeredTools(t, s) {
		raw, err := json.Marshal(tool)
		if err != nil {
			t.Fatalf("marshal %s: %v", tool.Name, err)
		}
		assertNoCatalogIDs(t, string(raw))
	}
}

func registeredTools(t *testing.T, s *mcpserver.MCPServer) []mcp.Tool {
	t.Helper()
	resp := s.HandleMessage(context.Background(), []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	result, ok := resp.(mcp.JSONRPCResponse)
	if !ok {
		t.Fatalf("expected JSONRPCResponse, got %T", resp)
	}
	listResult, ok := result.Result.(mcp.ListToolsResult)
	if !ok {
		t.Fatalf("expected ListToolsResult, got %T", result.Result)
	}
	return listResult.Tools
}

func registeredToolNames(t *testing.T, s *mcpserver.MCPServer) map[string]bool {
	t.Helper()
	tools := registeredTools(t, s)
	names := make(map[string]bool, len(tools))
	for _, tool := range tools {
		names[tool.Name] = true
	}
	return names
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
