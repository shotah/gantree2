package tools

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/mmcdole/gofeed"
)

const rssFeed = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example RSS</title>
    <link>https://example.com</link>
    <item>
      <guid>guid-1</guid>
      <title>First</title>
      <link>https://example.com/1</link>
      <description>Hello <b>world</b></description>
      <pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate>
    </item>
    <item>
      <title>No guid</title>
      <link>https://example.com/2</link>
    </item>
    <item>
      <title>Dropped — no id</title>
    </item>
  </channel>
</rss>`

const atomFeed = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom</title>
  <link href="https://example.com/atom"/>
  <entry>
    <id>atom-1</id>
    <title>Entry</title>
    <link href="https://example.com/a"/>
    <updated>2026-01-02T00:00:00Z</updated>
    <summary>Sum</summary>
  </entry>
</feed>`

const jsonFeed = `{
  "version": "https://jsonfeed.org/version/1",
  "title": "Example JSON",
  "feed_url": "https://example.com/feed.json",
  "items": [
    {"id": "jf-1", "title": "JF", "url": "https://example.com/j", "content_text": "Body"}
  ]
}`

func TestFetchFeedRSS(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		_, _ = io.WriteString(w, rssFeed)
	}))
	t.Cleanup(srv.Close)

	got, err := FetchFeed(context.Background(), &HTTPFetcher{Client: srv.Client()}, srv.URL, 25)
	if err != nil {
		t.Fatalf("FetchFeed: %v", err)
	}
	if got.Title != "Example RSS" {
		t.Fatalf("title = %q", got.Title)
	}
	if len(got.Items) != 2 {
		t.Fatalf("items = %d, want 2 (third dropped): %+v", len(got.Items), got.Items)
	}
	if got.Items[0].ID != "guid-1" || got.Items[0].Title != "First" || got.Items[0].URL != "https://example.com/1" {
		t.Fatalf("item0 = %+v", got.Items[0])
	}
	if !strings.Contains(got.Items[0].Summary, "Hello world") {
		t.Fatalf("summary should strip tags: %q", got.Items[0].Summary)
	}
	if got.Items[1].ID != "https://example.com/2" {
		t.Fatalf("id fallback to url: %+v", got.Items[1])
	}
}

func TestFetchFeedAtom(t *testing.T) {
	t.Parallel()
	srv := serveBytes(t, atomFeed, "application/atom+xml")
	got, err := FetchFeed(context.Background(), &HTTPFetcher{Client: srv.Client()}, srv.URL, 10)
	if err != nil {
		t.Fatalf("FetchFeed: %v", err)
	}
	if got.Title != "Example Atom" || len(got.Items) != 1 || got.Items[0].ID != "atom-1" {
		t.Fatalf("got %+v", got)
	}
	if got.Items[0].Published == "" {
		t.Fatal("expected published timestamp")
	}
}

func TestFetchFeedJSON(t *testing.T) {
	t.Parallel()
	srv := serveBytes(t, jsonFeed, "application/feed+json")
	got, err := FetchFeed(context.Background(), &HTTPFetcher{Client: srv.Client()}, srv.URL, 10)
	if err != nil {
		t.Fatalf("FetchFeed: %v", err)
	}
	if got.Title != "Example JSON" || len(got.Items) != 1 || got.Items[0].ID != "jf-1" {
		t.Fatalf("got %+v", got)
	}
}

func TestFetchFeedHTMLIsNotAFeed(t *testing.T) {
	t.Parallel()
	srv := serveBytes(t, `<!DOCTYPE html><html><body>blog</body></html>`, "text/html")
	_, err := FetchFeed(context.Background(), &HTTPFetcher{Client: srv.Client()}, srv.URL, 10)
	if err == nil || !strings.Contains(err.Error(), "source_resolve") {
		t.Fatalf("err = %v, want teach-in source_resolve", err)
	}
}

func TestFetchFeedHTMLByBody(t *testing.T) {
	t.Parallel()
	srv := serveBytes(t, `<html><head><title>x</title></head></html>`, "application/octet-stream")
	_, err := FetchFeed(context.Background(), &HTTPFetcher{Client: srv.Client()}, srv.URL, 10)
	if err == nil || !strings.Contains(err.Error(), "web page") {
		t.Fatalf("err = %v", err)
	}
}

func TestFetchFeedNotAFeed(t *testing.T) {
	t.Parallel()
	srv := serveBytes(t, `plain text, not a feed`, "text/plain")
	_, err := FetchFeed(context.Background(), &HTTPFetcher{Client: srv.Client()}, srv.URL, 10)
	if err == nil || !strings.Contains(err.Error(), "not a feed") {
		t.Fatalf("err = %v", err)
	}
}

func TestFetchFeedLimit(t *testing.T) {
	t.Parallel()
	items := make([]string, 60)
	for i := range items {
		n := strconv.Itoa(i)
		items[i] = `<item><guid>id-` + n + `</guid><title>T</title><link>https://example.com/` + n + `</link></item>`
	}
	body := `<?xml version="1.0"?><rss version="2.0"><channel><title>Many</title>` + strings.Join(items, "") + `</channel></rss>`
	srv := serveBytes(t, body, "application/rss+xml")
	f := &HTTPFetcher{Client: srv.Client()}

	got, err := FetchFeed(context.Background(), f, srv.URL, 3)
	if err != nil {
		t.Fatalf("limit 3: %v", err)
	}
	if len(got.Items) != 3 {
		t.Fatalf("limit 3 → %d items", len(got.Items))
	}

	got, err = FetchFeed(context.Background(), f, srv.URL, 0)
	if err != nil {
		t.Fatalf("limit 0: %v", err)
	}
	if len(got.Items) != defaultLimit {
		t.Fatalf("limit 0 (default) → %d, want %d", len(got.Items), defaultLimit)
	}

	got, err = FetchFeed(context.Background(), f, srv.URL, 999)
	if err != nil {
		t.Fatalf("limit 999: %v", err)
	}
	if len(got.Items) != maxLimit {
		t.Fatalf("limit 999 (capped) → %d, want %d", len(got.Items), maxLimit)
	}
}

func TestFetchFeedWatchJSONContract(t *testing.T) {
	t.Parallel()
	srv := serveBytes(t, rssFeed, "application/rss+xml")
	got, err := FetchFeed(context.Background(), &HTTPFetcher{Client: srv.Client()}, srv.URL, 10)
	if err != nil {
		t.Fatalf("FetchFeed: %v", err)
	}
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	var parsed struct {
		Items []struct {
			ID      string `json:"id"`
			Title   string `json:"title"`
			URL     string `json:"url"`
			Summary string `json:"summary"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("watch JSON: %v", err)
	}
	if len(parsed.Items) == 0 || parsed.Items[0].ID == "" {
		t.Fatalf("missing items/id: %s", raw)
	}
}

func TestFetchFeedInvalidURL(t *testing.T) {
	t.Parallel()
	_, err := FetchFeed(context.Background(), nil, "ftp://x", 10)
	if err == nil {
		t.Fatal("expected url error")
	}
}

func TestFetchFeedNilFetcherUsesDefault(t *testing.T) {
	t.Parallel()
	srv := serveBytes(t, jsonFeed, "application/feed+json")
	got, err := FetchFeed(context.Background(), nil, srv.URL, 5)
	if err != nil {
		t.Fatalf("nil fetcher: %v", err)
	}
	if len(got.Items) != 1 || got.Items[0].ID != "jf-1" {
		t.Fatalf("got %+v", got)
	}
}

func TestFetchFeedGetError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "down", http.StatusBadGateway)
	}))
	t.Cleanup(srv.Close)
	_, err := FetchFeed(context.Background(), &HTTPFetcher{Client: srv.Client()}, srv.URL, 10)
	if err == nil {
		t.Fatal("expected GET error")
	}
}

func TestItemFromGofeedPublishedFallback(t *testing.T) {
	t.Parallel()
	it := itemFromGofeed(&gofeed.Item{
		GUID:      "g",
		Link:      "https://example.com/x",
		Title:     "T",
		Published: "yesterday",
	})
	if it.ID != "g" || it.Published != "yesterday" {
		t.Fatalf("item = %+v", it)
	}
}

func TestLooksLikeHTML(t *testing.T) {
	t.Parallel()
	if !looksLikeHTML(nil, "text/html") {
		t.Fatal("text/html")
	}
	if looksLikeHTML(nil, "application/xhtml+xml") {
		t.Fatal("xhtml+xml should not trip html-only check")
	}
	if !looksLikeHTML([]byte("<!DOCTYPE HTML>"), "") {
		t.Fatal("doctype")
	}
	if looksLikeHTML([]byte("<rss/>"), "application/xml") {
		t.Fatal("xml is not html")
	}
}

func TestStripTagsAndTruncate(t *testing.T) {
	t.Parallel()
	if got := stripTags("  a <em>b</em>  c "); got != "a b c" {
		t.Fatalf("stripTags = %q", got)
	}
	if got := truncateRunes("hi", 5); got != "hi" {
		t.Fatalf("short = %q", got)
	}
	if got := truncateRunes("abcdef", 3); got != "abc…" {
		t.Fatalf("trunc = %q", got)
	}
	if got := firstNonEmpty("", "  ", "x"); got != "x" {
		t.Fatalf("firstNonEmpty = %q", got)
	}
}

func serveBytes(t *testing.T, body, ct string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv
}
