package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
	"github.com/shotah/feeds-mcp/server"
)

func TestHandleFetchMissingURL(t *testing.T) {
	t.Parallel()
	text := callHandlerErr(t, handleFetch, map[string]any{})
	if !strings.Contains(text, "url is required") || !strings.Contains(text, "Next: items_list") {
		t.Fatalf("teach-in = %q", text)
	}
}

func TestHandleResolveMissingQuery(t *testing.T) {
	t.Parallel()
	text := callHandlerErr(t, handleResolve, map[string]any{})
	if !strings.Contains(text, "query is required") || !strings.Contains(text, "Next: source_resolve") {
		t.Fatalf("teach-in = %q", text)
	}
}

func TestHandleFetchSuccess(t *testing.T) {
	t.Parallel()
	srv := serveBytes(t, rssFeed, "application/rss+xml")
	text := callHandlerOK(t, handleFetch, map[string]any{"url": srv.URL, "limit": 2})
	var got FetchResult
	if err := json.Unmarshal([]byte(text), &got); err != nil {
		t.Fatalf("json: %v (%s)", err, text)
	}
	if len(got.Items) == 0 || got.Items[0].ID == "" {
		t.Fatalf("result = %+v", got)
	}
}

func TestHandleFetchHTMLError(t *testing.T) {
	t.Parallel()
	srv := serveBytes(t, `<!DOCTYPE html><html><body>nope</body></html>`, "text/html")
	text := callHandlerErr(t, handleFetch, map[string]any{"url": srv.URL})
	if !strings.Contains(text, "source_resolve") {
		t.Fatalf("err = %q", text)
	}
}

func TestHandleResolveNWS(t *testing.T) {
	t.Parallel()
	text := callHandlerOK(t, handleResolve, map[string]any{"query": "CAZ513"})
	var got ResolveResult
	if err := json.Unmarshal([]byte(text), &got); err != nil {
		t.Fatalf("json: %v (%s)", err, text)
	}
	if len(got.Candidates) != 1 || got.Candidates[0].Source != "nws" {
		t.Fatalf("result = %+v", got)
	}
}

func TestHandleResolveInvalidURL(t *testing.T) {
	t.Parallel()
	text := callHandlerErr(t, handleResolve, map[string]any{"query": "http://"})
	if text == "" {
		t.Fatal("expected url error text")
	}
}

func TestHandleResolveNoFeed(t *testing.T) {
	t.Parallel()
	text := callHandlerErr(t, handleResolve, map[string]any{"query": "not-a-url-or-zone"})
	if !strings.Contains(text, "no feed found") {
		t.Fatalf("err = %q", text)
	}
}

func TestHandleResolveHTMLLinks(t *testing.T) {
	t.Parallel()
	page := `<!DOCTYPE html><html><head>
<link rel="alternate" type="application/rss+xml" title="Blog" href="/rss.xml">
</head><body></body></html>`
	srv := serveBytes(t, page, "text/html")
	text := callHandlerOK(t, handleResolve, map[string]any{"query": srv.URL})
	var got ResolveResult
	if err := json.Unmarshal([]byte(text), &got); err != nil {
		t.Fatalf("json: %v (%s)", err, text)
	}
	if len(got.Candidates) != 1 || got.Candidates[0].Source != "link" {
		t.Fatalf("result = %+v", got)
	}
}

func TestMCPCallItemsList(t *testing.T) {
	t.Parallel()
	srv := serveBytes(t, atomFeed, "application/atom+xml")
	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolList, map[string]any{"url": srv.URL})
	if isErr {
		t.Fatalf("items_list error: %s", text)
	}
	if !strings.Contains(text, `"items"`) || !strings.Contains(text, "atom-1") {
		t.Fatalf("payload = %s", text)
	}
}

func TestMCPCallSourceResolve(t *testing.T) {
	t.Parallel()
	s := newToolServer(t)
	text, isErr := callTool(t, s, ToolResolve, map[string]any{"query": "CAZ513"})
	if isErr {
		t.Fatalf("source_resolve error: %s", text)
	}
	if !strings.Contains(text, "api.weather.gov") {
		t.Fatalf("payload = %s", text)
	}
}

func newToolServer(t *testing.T) *mcpserver.MCPServer {
	t.Helper()
	s := server.New()
	Register(s)
	return s
}

func callHandlerOK(t *testing.T, handler func(context.Context, mcp.CallToolRequest) (*mcp.CallToolResult, error), args map[string]any) string {
	t.Helper()
	req := mcp.CallToolRequest{Params: mcp.CallToolParams{Arguments: args}}
	result, err := handler(context.Background(), req)
	if err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	if result.IsError {
		tc, _ := result.Content[0].(mcp.TextContent)
		t.Fatalf("handler returned tool error: %s", tc.Text)
	}
	if len(result.Content) == 0 {
		t.Fatal("handler returned empty content")
	}
	tc, ok := result.Content[0].(mcp.TextContent)
	if !ok {
		t.Fatalf("expected TextContent, got %T", result.Content[0])
	}
	return tc.Text
}

func callHandlerErr(t *testing.T, handler func(context.Context, mcp.CallToolRequest) (*mcp.CallToolResult, error), args map[string]any) string {
	t.Helper()
	req := mcp.CallToolRequest{Params: mcp.CallToolParams{Arguments: args}}
	result, err := handler(context.Background(), req)
	if err != nil {
		t.Fatalf("handler returned unexpected Go error: %v", err)
	}
	if !result.IsError {
		tc := result.Content[0].(mcp.TextContent)
		t.Fatalf("expected tool error, got success: %s", tc.Text)
	}
	tc := result.Content[0].(mcp.TextContent)
	return tc.Text
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
