package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
	"github.com/mmcdole/gofeed"
	"golang.org/x/net/html"
)

var (
	nwsZoneRe      = regexp.MustCompile(`(?i)\b([A-Z]{2}[ZC]\d{3})\b`)
	githubRepoRe   = regexp.MustCompile(`(?i)^https?://(?:www\.)?github\.com/([^/]+)/([^/#?]+)`)
	ytChannelRe    = regexp.MustCompile(`(?i)youtube\.com/channel/(UC[\w-]+)`)
	ytChannelIDRe  = regexp.MustCompile(`"channelId"\s*:\s*"(UC[\w-]+)"`)
	wellKnownPaths = []string{"/feed", "/rss.xml", "/atom.xml", "/feed.xml", "/rss", "/index.xml"}
)

// Candidate is one discovered feed URL.
type Candidate struct {
	URL    string `json:"url"`
	Title  string `json:"title,omitempty"`
	Kind   string `json:"kind,omitempty"`
	Source string `json:"source,omitempty"`
}

// ResolveResult is what source_resolve returns.
type ResolveResult struct {
	Query      string      `json:"query"`
	Candidates []Candidate `json:"candidates"`
}

func registerResolve(s *mcpserver.MCPServer) {
	tool := mcp.NewTool(ToolResolve,
		mcp.WithDescription("Find an RSS/Atom/JSON Feed URL from a page, GitHub repo, NWS zone, or YouTube channel. Use before watch_add when the human named a site, not a feed. Returns candidate URLs — then items_list or watch_add with the pick. Not a general web search."),
		mcp.WithString("query", mcp.Required(), mcp.Description("Page URL, feed URL, github.com/owner/repo, NWS zone like CAZ513, or YouTube channel URL.")),
		mcp.WithReadOnlyHintAnnotation(true),
	)
	registerTool(s, tool, handleResolve)
}

func handleResolve(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	query, err := request.RequireString("query")
	if err != nil {
		return mcp.NewToolResultError(`query is required. Next: source_resolve(query="https://…") or source_resolve(query="CAZ513")`), nil
	}
	result, err := ResolveFeed(ctx, defaultFetcher(), query)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if len(result.Candidates) == 0 {
		return mcp.NewToolResultError("no feed found. Try a direct rss.xml / atom.xml URL, a GitHub repo URL, or an NWS zone like CAZ513"), nil
	}
	b, err := json.Marshal(result)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return mcp.NewToolResultText(string(b)), nil
}

// ResolveFeed finds feed URLs for query without being a crawler.
func ResolveFeed(ctx context.Context, f Fetcher, query string) (ResolveResult, error) {
	query = strings.TrimSpace(query)
	out := ResolveResult{Query: query, Candidates: []Candidate{}}
	if query == "" {
		return out, errors.New("query is required")
	}
	if f == nil {
		f = defaultFetcher()
	}

	if c, ok := nwsCandidate(query); ok {
		out.Candidates = append(out.Candidates, c)
		return out, nil
	}

	if !looksLikeURL(query) {
		return out, nil
	}
	if err := validateURL(query); err != nil {
		return out, err
	}

	if c, ok := githubCandidate(query); ok {
		out.Candidates = append(out.Candidates, c)
	}
	if c, ok := youtubeChannelCandidate(query); ok {
		out.Candidates = append(out.Candidates, c)
	}

	body, ct, finalURL, err := f.Get(ctx, query)
	if err != nil {
		if len(out.Candidates) > 0 {
			return out, nil
		}
		return out, err
	}

	if !looksLikeHTML(body, ct) {
		if feedTitle, ok := parseFeedTitle(body); ok {
			out.Candidates = prependUnique(out.Candidates, Candidate{
				URL:    firstNonEmpty(finalURL, query),
				Title:  feedTitle,
				Kind:   kindFromContentType(ct),
				Source: "self",
			})
			return out, nil
		}
	}

	for _, c := range htmlFeedLinks(body, finalURL) {
		out.Candidates = appendUnique(out.Candidates, c)
	}
	if c, ok := youtubeFromHTML(body); ok {
		out.Candidates = appendUnique(out.Candidates, c)
	}

	if len(out.Candidates) == 0 {
		for _, path := range wellKnownPaths {
			probe := joinPath(finalURL, path)
			if probe == "" {
				continue
			}
			b, pct, pu, err := f.Get(ctx, probe)
			if err != nil {
				continue
			}
			if looksLikeHTML(b, pct) {
				continue
			}
			if title, ok := parseFeedTitle(b); ok {
				out.Candidates = appendUnique(out.Candidates, Candidate{
					URL:    firstNonEmpty(pu, probe),
					Title:  title,
					Kind:   kindFromContentType(pct),
					Source: "well-known",
				})
				break
			}
		}
	}
	return out, nil
}

func nwsCandidate(query string) (Candidate, bool) {
	m := nwsZoneRe.FindStringSubmatch(strings.ToUpper(query))
	if m == nil {
		return Candidate{}, false
	}
	zone := strings.ToUpper(m[1])
	return Candidate{
		URL:    "https://api.weather.gov/alerts/active.atom?zone=" + zone,
		Title:  "NWS alerts " + zone,
		Kind:   "atom",
		Source: "nws",
	}, true
}

func githubCandidate(raw string) (Candidate, bool) {
	m := githubRepoRe.FindStringSubmatch(raw)
	if m == nil {
		return Candidate{}, false
	}
	owner := m[1]
	repo := strings.TrimSuffix(m[2], ".git")
	if owner == "" || repo == "" || strings.EqualFold(owner, "orgs") || strings.EqualFold(owner, "settings") {
		return Candidate{}, false
	}
	return Candidate{
		URL:    "https://github.com/" + owner + "/" + repo + "/releases.atom",
		Title:  owner + "/" + repo + " releases",
		Kind:   "atom",
		Source: "github",
	}, true
}

func youtubeChannelCandidate(raw string) (Candidate, bool) {
	m := ytChannelRe.FindStringSubmatch(raw)
	if m == nil {
		return Candidate{}, false
	}
	return youtubeCandidate(m[1]), true
}

func youtubeFromHTML(body []byte) (Candidate, bool) {
	m := ytChannelIDRe.FindSubmatch(body)
	if m == nil {
		return Candidate{}, false
	}
	return youtubeCandidate(string(m[1])), true
}

func youtubeCandidate(id string) Candidate {
	return Candidate{
		URL:    "https://www.youtube.com/feeds/videos.xml?channel_id=" + id,
		Title:  "YouTube " + id,
		Kind:   "atom",
		Source: "youtube",
	}
}

func htmlFeedLinks(body []byte, base string) []Candidate {
	doc, err := html.Parse(bytes.NewReader(body))
	if err != nil {
		return nil
	}
	baseURL, _ := url.Parse(base)
	var out []Candidate
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "link" {
			rel, typ, href, title := "", "", "", ""
			for _, a := range n.Attr {
				switch strings.ToLower(a.Key) {
				case "rel":
					rel = strings.ToLower(a.Val)
				case "type":
					typ = strings.ToLower(a.Val)
				case "href":
					href = a.Val
				case "title":
					title = a.Val
				}
			}
			if href != "" && strings.Contains(rel, "alternate") && isFeedType(typ) {
				abs := resolveHref(baseURL, href)
				if abs != "" {
					out = append(out, Candidate{
						URL:    abs,
						Title:  title,
						Kind:   kindFromContentType(typ),
						Source: "link",
					})
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	return out
}

func isFeedType(typ string) bool {
	switch {
	case strings.Contains(typ, "rss"),
		strings.Contains(typ, "atom"),
		strings.Contains(typ, "json"):
		return true
	default:
		return false
	}
}

func kindFromContentType(ct string) string {
	switch {
	case strings.Contains(ct, "atom"):
		return "atom"
	case strings.Contains(ct, "rss"):
		return "rss"
	case strings.Contains(ct, "json"):
		return "json"
	default:
		return "feed"
	}
}

func parseFeedTitle(body []byte) (string, bool) {
	feed, err := gofeed.NewParser().Parse(bytes.NewReader(body))
	if err != nil || feed == nil {
		return "", false
	}
	return strings.TrimSpace(feed.Title), true
}

func looksLikeURL(s string) bool {
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
}

func resolveHref(base *url.URL, href string) string {
	href = strings.TrimSpace(href)
	if href == "" {
		return ""
	}
	u, err := url.Parse(href)
	if err != nil {
		return ""
	}
	if base != nil {
		u = base.ResolveReference(u)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ""
	}
	return u.String()
}

func joinPath(raw, path string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	u.Path = path
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}

func appendUnique(list []Candidate, c Candidate) []Candidate {
	for _, x := range list {
		if x.URL == c.URL {
			return list
		}
	}
	return append(list, c)
}

func prependUnique(list []Candidate, c Candidate) []Candidate {
	for _, x := range list {
		if x.URL == c.URL {
			return list
		}
	}
	return append([]Candidate{c}, list...)
}
