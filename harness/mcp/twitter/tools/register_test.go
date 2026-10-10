package tools

import (
	"context"
	"regexp"
	"strings"
	"testing"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
	"github.com/shotah/twitter-mcp/server"
)

var toolNameRe = regexp.MustCompile(`^[a-z]+_[a-z]+`)

func TestToolNamesLocked(t *testing.T) {
	t.Parallel()
	names := ToolNames()
	if len(names) != 1 || names[0] != ToolList || ToolList != "posts_list" {
		t.Fatalf("catalog = %v, want [posts_list]", names)
	}
	for _, name := range names {
		if !toolNameRe.MatchString(name) {
			t.Errorf("%q does not match ^[a-z]+_[a-z]+", name)
		}
		if strings.HasPrefix(name, "twitter") {
			t.Errorf("%q starts with twitter (host would expose twitter__%s)", name, name)
		}
	}
}

func TestRegisteredToolNames(t *testing.T) {
	t.Parallel()
	s := server.New()
	Register(s)
	got := listedToolNames(t, s)
	if len(got) != 1 || !got[ToolList] {
		t.Fatalf("registered = %v, want posts_list", got)
	}
	for name := range got {
		if !toolNameRe.MatchString(name) {
			t.Errorf("%q does not match ^[a-z]+_[a-z]+", name)
		}
		if strings.HasPrefix(name, "twitter") {
			t.Errorf("%q starts with twitter", name)
		}
	}
}

func listedToolNames(t *testing.T, s *mcpserver.MCPServer) map[string]bool {
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
	names := make(map[string]bool, len(listResult.Tools))
	for _, tool := range listResult.Tools {
		names[tool.Name] = true
	}
	return names
}
