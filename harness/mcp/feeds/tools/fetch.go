package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
	"github.com/mmcdole/gofeed"
)

const (
	defaultLimit = 25
	maxLimit     = 50
	maxSummary   = 500
)

// Item is one feed entry. Id is the watch cursor key (guid, else url).
type Item struct {
	ID        string `json:"id"`
	Title     string `json:"title,omitempty"`
	URL       string `json:"url,omitempty"`
	Summary   string `json:"summary,omitempty"`
	Published string `json:"published,omitempty"`
}

// FetchResult is the JSON the watch poller parses ({"items":[...]}).
type FetchResult struct {
	Title string `json:"title,omitempty"`
	URL   string `json:"url,omitempty"`
	Items []Item `json:"items"`
}

func registerFetch(s *mcpserver.MCPServer) {
	tool := mcp.NewTool(ToolList,
		mcp.WithDescription("List items from an RSS, Atom, or JSON Feed URL (id, title, url, summary). Use for “what’s new on this feed” and as the watch poller tool. Not a web crawl — needs a feed URL. Discover one with source_resolve. Not X/Twitter."),
		mcp.WithString("url", mcp.Required(), mcp.Description("Feed URL (rss.xml, atom.xml, NWS alerts.atom, GitHub releases.atom).")),
		mcp.WithNumber("limit", mcp.Description("Max items to return (default 25, max 50).")),
		mcp.WithReadOnlyHintAnnotation(true),
	)
	registerTool(s, tool, handleFetch)
}

func handleFetch(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	rawURL, err := request.RequireString("url")
	if err != nil {
		return mcp.NewToolResultError(`url is required. Next: items_list(url="https://…/rss.xml")`), nil
	}
	limit := request.GetInt("limit", defaultLimit)
	result, err := FetchFeed(ctx, defaultFetcher(), rawURL, limit)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	b, err := json.Marshal(result)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return mcp.NewToolResultText(string(b)), nil
}

// FetchFeed GETs url and parses RSS / Atom / JSON Feed.
func FetchFeed(ctx context.Context, f Fetcher, rawURL string, limit int) (FetchResult, error) {
	rawURL = strings.TrimSpace(rawURL)
	if err := validateURL(rawURL); err != nil {
		return FetchResult{}, err
	}
	if limit < 1 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	if f == nil {
		f = defaultFetcher()
	}
	body, ct, finalURL, err := f.Get(ctx, rawURL)
	if err != nil {
		return FetchResult{}, err
	}
	if looksLikeHTML(body, ct) {
		return FetchResult{}, fmt.Errorf(`url looks like a web page, not a feed. Next: source_resolve(query=%q)`, rawURL)
	}
	parser := gofeed.NewParser()
	feed, err := parser.Parse(bytes.NewReader(body))
	if err != nil {
		return FetchResult{}, fmt.Errorf("not a feed: %w", err)
	}
	out := FetchResult{
		Title: strings.TrimSpace(feed.Title),
		URL:   firstNonEmpty(feed.FeedLink, feed.Link, finalURL, rawURL),
		Items: make([]Item, 0, min(limit, len(feed.Items))),
	}
	for _, it := range feed.Items {
		if it == nil {
			continue
		}
		item := itemFromGofeed(it)
		if item.ID == "" {
			continue
		}
		out.Items = append(out.Items, item)
		if len(out.Items) >= limit {
			break
		}
	}
	return out, nil
}

func itemFromGofeed(it *gofeed.Item) Item {
	url := strings.TrimSpace(it.Link)
	id := firstNonEmpty(strings.TrimSpace(it.GUID), url)
	published := ""
	if it.PublishedParsed != nil {
		published = it.PublishedParsed.UTC().Format(time.RFC3339)
	} else if it.UpdatedParsed != nil {
		published = it.UpdatedParsed.UTC().Format(time.RFC3339)
	} else {
		published = firstNonEmpty(it.Published, it.Updated)
	}
	summary := stripTags(firstNonEmpty(it.Description, it.Content))
	return Item{
		ID:        id,
		Title:     strings.TrimSpace(it.Title),
		URL:       url,
		Summary:   truncateRunes(summary, maxSummary),
		Published: published,
	}
}

func looksLikeHTML(body []byte, ct string) bool {
	if strings.Contains(ct, "html") && !strings.Contains(ct, "xml") {
		return true
	}
	s := strings.TrimSpace(string(body))
	if len(s) > 256 {
		s = s[:256]
	}
	low := strings.ToLower(s)
	if strings.HasPrefix(low, "<!doctype html") || strings.HasPrefix(low, "<html") {
		return true
	}
	return false
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func stripTags(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	in := false
	for _, r := range s {
		switch {
		case r == '<':
			in = true
		case r == '>':
			in = false
		case !in:
			b.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func truncateRunes(s string, n int) string {
	if n < 1 || utf8.RuneCountInString(s) <= n {
		return s
	}
	var b strings.Builder
	i := 0
	for _, r := range s {
		if i >= n {
			break
		}
		b.WriteRune(r)
		i++
	}
	return b.String() + "…"
}
