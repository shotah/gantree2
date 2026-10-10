package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
)

const (
	defaultLimit = 25
	maxLimit     = 50
)

var errMissingToken = errors.New(`X_BEARER_TOKEN is not set. Next: set X_BEARER_TOKEN on this process (app-only Bearer from developer.x.com), then posts_list(handle="foo")`)

// newClient builds the X API client. Tests replace this.
var newClient = clientFromEnv

// Item is one public post. Id is the watch cursor key (tweet id).
type Item struct {
	ID      string `json:"id"`
	Title   string `json:"title,omitempty"`
	URL     string `json:"url,omitempty"`
	Summary string `json:"summary,omitempty"`
}

// ListResult is the JSON the watch poller parses ({"items":[...]}).
type ListResult struct {
	Items []Item `json:"items"`
}

func registerPosts(s *mcpserver.MCPServer) {
	tool := mcp.NewTool(ToolList,
		mcp.WithDescription("List recent public posts from an X/Twitter handle (id, title, url, summary). Use for “watch this account” and “what did @foo post”. Official X API only — pay-per-use; prefer a 30–60m watch interval. Not a scrape, not RSS, not a home timeline."),
		mcp.WithString("handle", mcp.Required(), mcp.Description("Public @handle or username (leading @ is stripped).")),
		mcp.WithNumber("limit", mcp.Description("Max posts to return (default 25, max 50).")),
		mcp.WithReadOnlyHintAnnotation(true),
	)
	registerTool(s, tool, handlePosts)
}

func handlePosts(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	handle, err := request.RequireString("handle")
	if err != nil {
		return mcp.NewToolResultError(`handle is required. Next: posts_list(handle="foo")`), nil
	}
	limit := request.GetInt("limit", defaultLimit)
	client, err := newClient()
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	result, err := ListPosts(ctx, client, handle, limit)
	if err != nil {
		return mcp.NewToolResultError(teachIn(err, handle)), nil
	}
	b, err := json.Marshal(result)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return mcp.NewToolResultText(string(b)), nil
}

// ListPosts looks up handle and returns recent public posts as watch items.
func ListPosts(ctx context.Context, c *Client, handle string, limit int) (ListResult, error) {
	handle, err := normalizeHandle(handle)
	if err != nil {
		return ListResult{}, err
	}
	if limit < 1 {
		limit = defaultLimit
	}
	limit = min(limit, maxLimit)
	if c == nil {
		return ListResult{}, errMissingToken
	}
	user, err := c.LookupUser(ctx, handle)
	if err != nil {
		return ListResult{}, err
	}
	tweets, err := c.ListTweets(ctx, user.ID, limit)
	if err != nil {
		return ListResult{}, err
	}
	out := ListResult{Items: make([]Item, 0, len(tweets))}
	for _, tw := range tweets {
		if tw.ID == "" {
			continue
		}
		url := fmt.Sprintf("https://x.com/%s/status/%s", user.Username, tw.ID)
		out.Items = append(out.Items, Item{
			ID:      tw.ID,
			Title:   tw.Text,
			URL:     url,
			Summary: tw.Text,
		})
	}
	return out, nil
}

func normalizeHandle(handle string) (string, error) {
	handle = strings.TrimSpace(handle)
	handle = strings.TrimPrefix(handle, "@")
	handle = strings.TrimSpace(handle)
	if handle == "" {
		return "", errors.New(`handle is required. Next: posts_list(handle="foo")`)
	}
	return handle, nil
}

func teachIn(err error, handle string) string {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		switch apiErr.Status {
		case http.StatusUnauthorized:
			return `X_BEARER_TOKEN was rejected (HTTP 401). Next: set a valid app-only Bearer from developer.x.com, then posts_list(handle="foo")`
		case http.StatusNotFound:
			return fmt.Sprintf(`handle %q was not found. Next: posts_list(handle="foo")`, handle)
		case http.StatusTooManyRequests:
			return `X API rate limited (HTTP 429). Next: wait, or poll every 30–60m via watch_add`
		}
	}
	return err.Error()
}
