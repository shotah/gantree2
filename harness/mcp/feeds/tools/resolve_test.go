package tools

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestResolveNWSZone(t *testing.T) {
	t.Parallel()
	got, err := ResolveFeed(context.Background(), nil, "CAZ513")
	if err != nil {
		t.Fatalf("ResolveFeed: %v", err)
	}
	if len(got.Candidates) != 1 {
		t.Fatalf("candidates = %+v", got.Candidates)
	}
	c := got.Candidates[0]
	if c.Source != "nws" || c.Kind != "atom" || !strings.Contains(c.URL, "zone=CAZ513") {
		t.Fatalf("nws candidate = %+v", c)
	}
}

func TestResolveNWSEmbeddedInText(t *testing.T) {
	t.Parallel()
	got, err := ResolveFeed(context.Background(), &HTTPFetcher{}, "alerts for caz513 please")
	if err != nil {
		t.Fatalf("ResolveFeed: %v", err)
	}
	if len(got.Candidates) != 1 || !strings.Contains(got.Candidates[0].URL, "CAZ513") {
		t.Fatalf("got %+v", got)
	}
}

func TestResolveGitHubReleases(t *testing.T) {
	t.Parallel()
	// Candidate is built from the URL; stub GET so we never touch the network.
	query := "https://github.com/shotah/feeds-mcp"
	got, err := ResolveFeed(context.Background(), &stubFetcher{err: io.EOF}, query)
	if err != nil {
		t.Fatalf("ResolveFeed: %v", err)
	}
	if len(got.Candidates) != 1 {
		t.Fatalf("candidates = %+v", got.Candidates)
	}
	c := got.Candidates[0]
	if c.URL != "https://github.com/shotah/feeds-mcp/releases.atom" || c.Source != "github" {
		t.Fatalf("github = %+v", c)
	}
}

func TestResolveGitHubSkipsOrgs(t *testing.T) {
	t.Parallel()
	if c, ok := githubCandidate("https://github.com/orgs/foo"); ok {
		t.Fatalf("orgs should be skipped: %+v", c)
	}
	if c, ok := githubCandidate("https://github.com/settings/profile"); ok {
		t.Fatalf("settings should be skipped: %+v", c)
	}
	c, ok := githubCandidate("https://github.com/shotah/feeds-mcp.git")
	if !ok || !strings.HasSuffix(c.URL, "/feeds-mcp/releases.atom") {
		t.Fatalf(".git strip: ok=%v %+v", ok, c)
	}
}

func TestResolveYouTubeChannelURL(t *testing.T) {
	t.Parallel()
	id := "UCuAXFkgsw1L7xaCfnd5JJOw"
	query := "https://www.youtube.com/channel/" + id
	got, err := ResolveFeed(context.Background(), &stubFetcher{err: io.EOF}, query)
	if err != nil {
		t.Fatalf("ResolveFeed: %v", err)
	}
	if len(got.Candidates) != 1 || !strings.Contains(got.Candidates[0].URL, "channel_id="+id) {
		t.Fatalf("youtube = %+v", got.Candidates)
	}
}

func TestResolveHTMLLinkTags(t *testing.T) {
	t.Parallel()
	htmlPage := `<!DOCTYPE html><html><head>
<link rel="alternate" type="application/rss+xml" title="Blog" href="/rss.xml">
<link rel="alternate" type="application/atom+xml" title="Atom" href="https://cdn.example.com/atom.xml">
<link rel="stylesheet" href="/style.css">
</head><body>hi</body></html>`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, htmlPage)
	}))
	t.Cleanup(srv.Close)

	got, err := ResolveFeed(context.Background(), &HTTPFetcher{Client: srv.Client()}, srv.URL)
	if err != nil {
		t.Fatalf("ResolveFeed: %v", err)
	}
	if len(got.Candidates) != 2 {
		t.Fatalf("candidates = %+v", got.Candidates)
	}
	if got.Candidates[0].Source != "link" || !strings.HasSuffix(got.Candidates[0].URL, "/rss.xml") {
		t.Fatalf("relative link = %+v", got.Candidates[0])
	}
	if got.Candidates[1].URL != "https://cdn.example.com/atom.xml" || got.Candidates[1].Kind != "atom" {
		t.Fatalf("absolute link = %+v", got.Candidates[1])
	}
}

func TestResolveWellKnownRSS(t *testing.T) {
	t.Parallel()
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, `<!DOCTYPE html><html><body>no links</body></html>`)
	})
	mux.HandleFunc("/rss.xml", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml")
		_, _ = io.WriteString(w, rssFeed)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	got, err := ResolveFeed(context.Background(), &HTTPFetcher{Client: srv.Client()}, srv.URL)
	if err != nil {
		t.Fatalf("ResolveFeed: %v", err)
	}
	if len(got.Candidates) != 1 {
		t.Fatalf("candidates = %+v", got.Candidates)
	}
	c := got.Candidates[0]
	if c.Source != "well-known" || !strings.HasSuffix(c.URL, "/rss.xml") || c.Title != "Example RSS" {
		t.Fatalf("well-known = %+v", c)
	}
}

func TestResolveSelfIsFeed(t *testing.T) {
	t.Parallel()
	srv := serveBytes(t, atomFeed, "application/atom+xml")
	got, err := ResolveFeed(context.Background(), &HTTPFetcher{Client: srv.Client()}, srv.URL)
	if err != nil {
		t.Fatalf("ResolveFeed: %v", err)
	}
	if len(got.Candidates) != 1 || got.Candidates[0].Source != "self" || got.Candidates[0].Kind != "atom" {
		t.Fatalf("self = %+v", got.Candidates)
	}
}

func TestResolveYouTubeFromHTML(t *testing.T) {
	t.Parallel()
	id := "UC1234567890abcdefghijkl"
	page := `<!DOCTYPE html><html><body><script>var x={"channelId":"` + id + `"}</script></body></html>`
	srv := serveBytes(t, page, "text/html")
	got, err := ResolveFeed(context.Background(), &HTTPFetcher{Client: srv.Client()}, srv.URL)
	if err != nil {
		t.Fatalf("ResolveFeed: %v", err)
	}
	found := false
	for _, c := range got.Candidates {
		if c.Source == "youtube" && strings.Contains(c.URL, id) {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing youtube candidate: %+v", got.Candidates)
	}
}

func TestResolveEmptyAndNonURL(t *testing.T) {
	t.Parallel()
	_, err := ResolveFeed(context.Background(), nil, "   ")
	if err == nil {
		t.Fatal("empty query should error")
	}
	got, err := ResolveFeed(context.Background(), nil, "just some words")
	if err != nil {
		t.Fatalf("non-url: %v", err)
	}
	if len(got.Candidates) != 0 {
		t.Fatalf("non-url candidates = %+v", got.Candidates)
	}
}

func TestResolveGETErrorNoCandidates(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "gone", http.StatusGone)
	}))
	t.Cleanup(srv.Close)
	_, err := ResolveFeed(context.Background(), &HTTPFetcher{Client: srv.Client()}, srv.URL)
	if err == nil {
		t.Fatal("expected GET error")
	}
}

func TestResolveInvalidURL(t *testing.T) {
	t.Parallel()
	_, err := ResolveFeed(context.Background(), nil, "http://")
	if err == nil {
		t.Fatal("expected url error")
	}
}

func TestKindAndFeedType(t *testing.T) {
	t.Parallel()
	if kindFromContentType("application/atom+xml") != "atom" {
		t.Fatal("atom")
	}
	if kindFromContentType("application/rss+xml") != "rss" {
		t.Fatal("rss")
	}
	if kindFromContentType("application/feed+json") != "json" {
		t.Fatal("json")
	}
	if kindFromContentType("application/xml") != "feed" {
		t.Fatal("generic")
	}
	if !isFeedType("application/rss+xml") || isFeedType("text/css") {
		t.Fatal("isFeedType")
	}
}

func TestAppendPrependUnique(t *testing.T) {
	t.Parallel()
	a := Candidate{URL: "https://a"}
	b := Candidate{URL: "https://b"}
	list := appendUnique(nil, a)
	list = appendUnique(list, a)
	list = appendUnique(list, b)
	if len(list) != 2 {
		t.Fatalf("appendUnique = %+v", list)
	}
	list = prependUnique(list, a)
	if len(list) != 2 || list[0].URL != "https://a" {
		t.Fatalf("prepend existing = %+v", list)
	}
	list = prependUnique(list, Candidate{URL: "https://c"})
	if list[0].URL != "https://c" {
		t.Fatalf("prepend new = %+v", list)
	}
}

func TestJoinPathAndResolveHref(t *testing.T) {
	t.Parallel()
	if joinPath("://bad", "/rss.xml") != "" {
		t.Fatal("bad join")
	}
	got := joinPath("https://example.com/blog/post", "/rss.xml")
	if got != "https://example.com/rss.xml" {
		t.Fatalf("joinPath = %q", got)
	}
	base, _ := url.Parse("https://example.com/blog/")
	if resolveHref(base, "") != "" || resolveHref(base, "mailto:x") != "" {
		t.Fatal("empty/mailto")
	}
	if got := resolveHref(base, "feed.xml"); got != "https://example.com/blog/feed.xml" {
		t.Fatalf("relative href = %q", got)
	}
}

func TestLooksLikeURL(t *testing.T) {
	t.Parallel()
	if !looksLikeURL("https://x") || looksLikeURL("x.com") {
		t.Fatal("looksLikeURL")
	}
}

func TestParseFeedTitle(t *testing.T) {
	t.Parallel()
	title, ok := parseFeedTitle([]byte(atomFeed))
	if !ok || title != "Example Atom" {
		t.Fatalf("title=%q ok=%v", title, ok)
	}
	if _, ok := parseFeedTitle([]byte("not a feed")); ok {
		t.Fatal("expected parse failure")
	}
}

func TestHTMLFeedLinksSkipsNonFeed(t *testing.T) {
	t.Parallel()
	body := []byte(`<html><head>
<link rel="alternate" type="text/html" href="/amp">
<link rel="alternate" type="application/rss+xml" href="javascript:alert(1)">
</head></html>`)
	if got := htmlFeedLinks(body, "https://example.com"); len(got) != 0 {
		t.Fatalf("expected no candidates, got %+v", got)
	}
}

func TestNWSAndYouTubeMiss(t *testing.T) {
	t.Parallel()
	if _, ok := nwsCandidate("hello"); ok {
		t.Fatal("nws miss")
	}
	if _, ok := youtubeChannelCandidate("https://example.com"); ok {
		t.Fatal("yt miss")
	}
	if _, ok := youtubeFromHTML([]byte("nope")); ok {
		t.Fatal("yt html miss")
	}
	if _, ok := githubCandidate("https://example.com/foo/bar"); ok {
		t.Fatal("github miss")
	}
}

func TestWellKnownSkipsHTMLProbe(t *testing.T) {
	t.Parallel()
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, `<!DOCTYPE html><html><body>x</body></html>`)
	})
	mux.HandleFunc("/atom.xml", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/atom+xml")
		_, _ = io.WriteString(w, atomFeed)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	got, err := ResolveFeed(context.Background(), &HTTPFetcher{Client: srv.Client()}, srv.URL)
	if err != nil {
		t.Fatalf("ResolveFeed: %v", err)
	}
	if len(got.Candidates) != 1 || got.Candidates[0].Source != "well-known" || !strings.HasSuffix(got.Candidates[0].URL, "/atom.xml") {
		t.Fatalf("got %+v", got.Candidates)
	}
}

// stubFetcher is an in-memory Fetcher (no network).
type stubFetcher struct {
	body  []byte
	ct    string
	final string
	err   error
}

func (s *stubFetcher) Get(_ context.Context, rawURL string) ([]byte, string, string, error) {
	if s.err != nil {
		return nil, "", rawURL, s.err
	}
	final := s.final
	if final == "" {
		final = rawURL
	}
	return s.body, s.ct, final, nil
}
