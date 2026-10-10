package tools

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/mark3labs/mcp-go/mcp"
)

func TestNormalizeHandle(t *testing.T) {
	t.Parallel()
	got, err := normalizeHandle("  @Foo ")
	if err != nil {
		t.Fatal(err)
	}
	if got != "Foo" {
		t.Fatalf("handle = %q, want Foo", got)
	}
	if _, err := normalizeHandle(" @ "); err == nil {
		t.Fatal("expected error for empty handle")
	}
	if _, err := normalizeHandle(""); err == nil {
		t.Fatal("expected error for empty handle")
	}
}

func TestListPosts(t *testing.T) {
	t.Parallel()
	srv := newXAPIServer(t, xAPIServer{
		username: "Foo",
		userID:   "42",
		tweets: []map[string]string{
			{"id": "123", "text": "hello world"},
			{"id": "124", "text": "second"},
			{"id": "", "text": "dropped"},
		},
	})
	got, err := ListPosts(context.Background(), testClient(srv), "@Foo", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 2 {
		t.Fatalf("items = %d, want 2: %+v", len(got.Items), got.Items)
	}
	if got.Items[0].ID != "123" || got.Items[0].Title != "hello world" {
		t.Fatalf("item[0] = %+v", got.Items[0])
	}
	if got.Items[0].URL != "https://x.com/Foo/status/123" {
		t.Fatalf("url = %q", got.Items[0].URL)
	}
	if got.Items[0].Summary != "hello world" {
		t.Fatalf("summary = %q", got.Items[0].Summary)
	}
}

func TestListPostsLimit(t *testing.T) {
	t.Parallel()
	tweets := make([]map[string]string, 10)
	for i := range tweets {
		tweets[i] = map[string]string{"id": string(rune('a' + i)), "text": "t"}
	}
	srv := newXAPIServer(t, xAPIServer{username: "foo", userID: "1", tweets: tweets})
	got, err := ListPosts(context.Background(), testClient(srv), "foo", 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 2 {
		t.Fatalf("items = %d, want 2", len(got.Items))
	}
}

func TestListPostsEmpty(t *testing.T) {
	t.Parallel()
	srv := newXAPIServer(t, xAPIServer{username: "foo", userID: "1"})
	got, err := ListPosts(context.Background(), testClient(srv), "foo", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got.Items == nil {
		t.Fatal("items is nil, want empty slice")
	}
	if len(got.Items) != 0 {
		t.Fatalf("items = %d, want 0", len(got.Items))
	}
}

func TestListPostsUnauthorized(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"title":"Unauthorized","status":401,"detail":"Unauthorized"}`))
	}))
	t.Cleanup(srv.Close)
	_, err := ListPosts(context.Background(), testClient(srv), "foo", 5)
	if err == nil {
		t.Fatal("expected 401")
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Status != http.StatusUnauthorized {
		t.Fatalf("err = %v", err)
	}
	msg := teachIn(err, "foo")
	if !strings.Contains(msg, "401") || !strings.Contains(msg, "Next: set a valid app-only Bearer") {
		t.Fatalf("teach-in = %q", msg)
	}
}

func TestListPostsUserNotFound(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/users/by/username/") {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"errors":[{"detail":"Could not find user with username: [missing].","title":"Not Found Error"}]}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	t.Cleanup(srv.Close)
	_, err := ListPosts(context.Background(), testClient(srv), "missing", 5)
	if err == nil {
		t.Fatal("expected 404")
	}
	msg := teachIn(err, "missing")
	if !strings.Contains(msg, `"missing"`) || !strings.Contains(msg, "Next: posts_list") {
		t.Fatalf("teach-in = %q", msg)
	}
}

func TestHandlePostsMissingHandle(t *testing.T) {
	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]any{}
	res, err := handlePosts(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if res == nil || !res.IsError {
		t.Fatal("expected tool error")
	}
	text := toolText(t, res)
	if !strings.Contains(text, "handle is required") || !strings.Contains(text, `Next: posts_list(handle="foo")`) {
		t.Fatalf("text = %q", text)
	}
}

func TestHandlePostsMissingToken(t *testing.T) {
	t.Setenv("X_BEARER_TOKEN", "")
	old := newClient
	t.Cleanup(func() { newClient = old })
	newClient = clientFromEnv

	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]any{"handle": "foo"}
	res, err := handlePosts(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if res == nil || !res.IsError {
		t.Fatal("expected tool error")
	}
	text := toolText(t, res)
	if !strings.Contains(text, "X_BEARER_TOKEN") || !strings.Contains(text, "Next:") {
		t.Fatalf("text = %q", text)
	}
}

func TestHandlePostsSuccess(t *testing.T) {
	srv := newXAPIServer(t, xAPIServer{
		username: "foo",
		userID:   "9",
		tweets:   []map[string]string{{"id": "555", "text": "hi"}},
	})
	old := newClient
	t.Cleanup(func() { newClient = old })
	newClient = func() (*Client, error) { return testClient(srv), nil }

	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]any{"handle": "foo", "limit": 5}
	res, err := handlePosts(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if res == nil || res.IsError {
		t.Fatalf("unexpected error: %s", toolText(t, res))
	}
	var got ListResult
	if err := json.Unmarshal([]byte(toolText(t, res)), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 1 || got.Items[0].ID != "555" {
		t.Fatalf("got %+v", got)
	}
}

func TestHandlePostsUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"title":"Unauthorized","status":401}`))
	}))
	t.Cleanup(srv.Close)
	old := newClient
	t.Cleanup(func() { newClient = old })
	newClient = func() (*Client, error) { return testClient(srv), nil }

	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]any{"handle": "foo"}
	res, err := handlePosts(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if res == nil || !res.IsError {
		t.Fatal("expected tool error")
	}
	if !strings.Contains(toolText(t, res), "401") {
		t.Fatalf("text = %q", toolText(t, res))
	}
}

func TestTeachInRateLimit(t *testing.T) {
	t.Parallel()
	msg := teachIn(&APIError{Status: http.StatusTooManyRequests, Title: "Too Many Requests"}, "foo")
	if !strings.Contains(msg, "429") || !strings.Contains(msg, "30–60m") {
		t.Fatalf("teach-in = %q", msg)
	}
}

func TestListPostsClampsLimit(t *testing.T) {
	t.Parallel()
	tweets := make([]map[string]string, maxLimit+5)
	for i := range tweets {
		tweets[i] = map[string]string{"id": strconv.Itoa(i + 1), "text": "t"}
	}
	srv := newXAPIServer(t, xAPIServer{username: "foo", userID: "1", tweets: tweets})
	got, err := ListPosts(context.Background(), testClient(srv), "foo", 999)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != maxLimit {
		t.Fatalf("items = %d, want %d", len(got.Items), maxLimit)
	}
}

func TestHandlePostsBlankHandle(t *testing.T) {
	old := newClient
	t.Cleanup(func() { newClient = old })
	newClient = func() (*Client, error) { return NewClient("x"), nil }

	req := mcp.CallToolRequest{}
	req.Params.Arguments = map[string]any{"handle": " @ "}
	res, err := handlePosts(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if res == nil || !res.IsError {
		t.Fatal("expected tool error")
	}
	if !strings.Contains(toolText(t, res), "handle is required") {
		t.Fatalf("text = %q", toolText(t, res))
	}
}

func TestTeachInPassthrough(t *testing.T) {
	t.Parallel()
	if teachIn(errors.New("boom"), "foo") != "boom" {
		t.Fatal(teachIn(errors.New("boom"), "foo"))
	}
}

func TestListPostsTweetListError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/users/by/username/") {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]string{"id": "1", "username": "foo"},
			})
			return
		}
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"title":"Too Many Requests","status":429}`))
	}))
	t.Cleanup(srv.Close)
	_, err := ListPosts(context.Background(), testClient(srv), "foo", 5)
	if err == nil {
		t.Fatal("expected 429")
	}
	if !strings.Contains(teachIn(err, "foo"), "429") {
		t.Fatalf("teach-in = %q", teachIn(err, "foo"))
	}
}

func TestListPostsNilClient(t *testing.T) {
	t.Parallel()
	_, err := ListPosts(context.Background(), nil, "foo", 5)
	if err == nil || !strings.Contains(err.Error(), "X_BEARER_TOKEN") {
		t.Fatalf("err = %v", err)
	}
}

type xAPIServer struct {
	username string
	userID   string
	tweets   []map[string]string
}

func newXAPIServer(t *testing.T, spec xAPIServer) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"title":"Unauthorized","status":401}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasPrefix(r.URL.Path, "/2/users/by/username/"):
			name := strings.TrimPrefix(r.URL.Path, "/2/users/by/username/")
			if !strings.EqualFold(name, spec.username) {
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"title":"Not Found Error"}`))
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]string{"id": spec.userID, "username": spec.username},
			})
		case strings.HasPrefix(r.URL.Path, "/2/users/") && strings.HasSuffix(r.URL.Path, "/tweets"):
			data := spec.tweets
			if data == nil {
				data = []map[string]string{}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func testClient(srv *httptest.Server) *Client {
	c := NewClient("test-token")
	c.HTTP = srv.Client()
	c.BaseURL = srv.URL
	return c
}

func toolText(t *testing.T, res *mcp.CallToolResult) string {
	t.Helper()
	if res == nil || len(res.Content) == 0 {
		return ""
	}
	tc, ok := res.Content[0].(mcp.TextContent)
	if !ok {
		t.Fatalf("content = %T", res.Content[0])
	}
	return tc.Text
}
