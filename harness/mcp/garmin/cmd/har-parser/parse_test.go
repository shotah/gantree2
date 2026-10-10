package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHARParsingHelpers(t *testing.T) {
	if isGarminAPI("://bad") {
		t.Fatal("bad url")
	}
	cases := []struct {
		raw  string
		want bool
	}{
		{"https://connectapi.garmin.com/activity-service/activity/1", true},
		{"https://connect.garmin.com/modern/proxy/activity-service/activity/1", true},
		{"https://connect.garmin.com/gc-api/activity-service/activity/1", true},
		{"https://connect.garmin.com/modern", false},
		{"https://example.com/activity-service/activity/1", false},
	}
	for _, tc := range cases {
		if got := isGarminAPI(tc.raw); got != tc.want {
			t.Errorf("isGarminAPI(%s)=%v", tc.raw, got)
		}
	}

	paths := map[string]string{
		"/a/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/b": "/a/{uuid}/b",
		"/activity/12345678/details":                "/activity/{id}/details",
		"/stats/2024-01-27/end":                     "/stats/{date}/end",
		"/stats/2024-01-27":                         "/stats/{date}/",
		"/device/1234567":                           "/device/{deviceId}/",
		"//12345678/":                               "/{id}/",
	}
	for in, want := range paths {
		if got := normalizePath(in); got != want {
			t.Errorf("normalizePath(%s)=%q, want %q", in, got, want)
		}
	}

	types := map[string]string{
		"":          "",
		"   ":       "",
		`[{"a":1}]`: "array",
		`{"a":1}`:   "object",
		"text":      "unknown",
	}
	for in, want := range types {
		if got := detectJSONType(in); got != want {
			t.Errorf("detectJSONType(%q)=%q", in, got)
		}
	}

	if getHeader([]Header{{Name: "Content-Type", Value: "application/json"}}, "content-type") != "application/json" {
		t.Fatal("header")
	}
	if getHeader(nil, "content-type") != "" {
		t.Fatal("missing header")
	}
	if (*PostData)(nil).GetText() != "" || (&PostData{Text: "body"}).GetText() != "body" {
		t.Fatal("GetText")
	}
	if extractService("/activity-service/activity") != "activity-service" || extractService("/modern/home") != "modern" {
		t.Fatal("service")
	}

	har := HAR{Log: struct {
		Entries []Entry `json:"entries"`
	}{Entries: []Entry{
		entry("https://example.com/nope", "application/json", `{}`, nil),
		entry("https://connectapi.garmin.com/activity-service/activity/1", "text/html", `<html>`, nil),
		entry("https://connectapi.garmin.com/activity-service/activity/11?start=1", "application/json", `{"id":11}`, &PostData{Text: `{"name":"a"}`}),
		entry("https://connect.garmin.com/modern/proxy/download-service/files/activity/11", "application/octet-stream", "", nil),
		entry("https://connectapi.garmin.com/wellness-service/wellness/daily/2024-01-27", "", `[]`, nil),
	}}}
	found := extractGarminEndpoints(har)
	if len(found) != 3 {
		t.Fatalf("endpoints %d", len(found))
	}
	parsed := found[0]
	if parsed.Path != "/activity-service/activity/11" || parsed.NormalizedPath != "/activity-service/activity/11" {
		t.Fatalf("short id stays literal: %+v", parsed)
	}
	if parsed.RequestBodyType != "object" || parsed.ResponseBodyType != "object" || parsed.Examples[0].QueryString != "start=1" {
		t.Fatalf("parsed %+v", parsed)
	}
	if len(parsed.QueryParams) != 1 || parsed.QueryParams[0] != "start" {
		t.Fatalf("query %#v", parsed.QueryParams)
	}

	second := parseEndpoint(entry("https://connect.garmin.com/proxy/activity-service/activity/11", "application/json", `{"id":2}`, nil))
	if second.Path != "/activity-service/activity/11" {
		t.Fatalf("trimmed %s", second.Path)
	}
	grouped := groupEndpoints([]Endpoint{parsed, parsed, second})
	if len(grouped) != 1 {
		t.Fatalf("groups %d", len(grouped))
	}
	for _, g := range grouped {
		if len(g.Examples) != 3 || len(g.StatusCodes) != 1 {
			t.Fatalf("merged %+v", g)
		}
	}

	other := parseEndpoint(entry("https://connectapi.garmin.com/wellness-service/x?b=1&a=2", "application/json", `[]`, nil))
	other.StatusCode = 204
	merged := groupEndpoints([]Endpoint{other, other})
	key := "GET " + other.NormalizedPath
	if len(merged[key].QueryParams) != 2 || len(merged[key].StatusCodes) != 1 {
		t.Fatalf("same status %#v", merged[key])
	}
	again := other
	again.StatusCode = 500
	again.QueryParams = []string{"c"}
	merged = groupEndpoints([]Endpoint{other, again})
	if len(merged[key].StatusCodes) != 2 || len(merged[key].QueryParams) != 3 {
		t.Fatalf("merged codes %#v params %#v", merged[key].StatusCodes, merged[key].QueryParams)
	}
}

func TestHAROutput(t *testing.T) {
	grouped := groupEndpoints([]Endpoint{
		parseEndpoint(entry("https://connectapi.garmin.com/activity-service/activity/1?limit=1", "application/json", `{"id":1}`, &PostData{Text: `{"n":1}`})),
		parseEndpoint(entry("https://connectapi.garmin.com/wellness-service/daily", "application/json", `[]`, nil)),
	})
	md := captureStdout(t, func() { outputMarkdown(grouped) })
	if !strings.Contains(md, "activity-service") || !strings.Contains(md, "wellness-service") || !strings.Contains(md, "limit") {
		t.Fatalf("markdown %s", md)
	}
	js := captureStdout(t, func() { outputJSON(grouped) })
	var decoded struct {
		TotalEndpoints int `json:"total_endpoints"`
	}
	if err := json.Unmarshal([]byte(js), &decoded); err != nil || decoded.TotalEndpoints != 2 {
		t.Fatalf("json %s err=%v", js, err)
	}

	foundDoc := filepath.Join(t.TempDir(), "ENDPOINTS.md")
	if err := os.WriteFile(foundDoc, []byte("/activity-service/activity/1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cmp := captureStdout(t, func() { compareWithEndpointsMD(foundDoc, grouped) })
	if !strings.Contains(cmp, "Found in ENDPOINTS.md") || !strings.Contains(cmp, "Missing from ENDPOINTS.md") {
		t.Fatalf("compare %s", cmp)
	}
	compareWithEndpointsMD(filepath.Join(t.TempDir(), "missing.md"), grouped)

	dir := t.TempDir()
	outputSchemas(dir, grouped)
	matches, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil || len(matches) != 2 {
		t.Fatalf("schemas %#v err=%v", matches, err)
	}

	outputSchemas(dir, map[string]*GroupedEndpoint{
		"empty": {Method: "GET", NormalizedPath: "/nope", Examples: nil},
		"blank": {Method: "GET", NormalizedPath: "/blank", Examples: []Example{{ResponseBody: ""}}},
		"bad":   {Method: "GET", NormalizedPath: "/bad", Examples: []Example{{ResponseBody: "not-json"}}},
	})

	file := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(file, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	outputSchemas(file, grouped)

	blocked := t.TempDir()
	if err := os.Mkdir(filepath.Join(blocked, "GET_svc.json"), 0o755); err != nil {
		t.Fatal(err)
	}
	outputSchemas(blocked, map[string]*GroupedEndpoint{
		"one": {Method: "GET", NormalizedPath: "/svc", Examples: []Example{{ResponseBody: `{"ok":1}`}}},
	})
}

func entry(rawURL, contentType, body string, post *PostData) Entry {
	headers := []Header{}
	if contentType != "" {
		headers = []Header{{Name: "Content-Type", Value: contentType}}
	}
	query := []NVP{}
	if strings.Contains(rawURL, "?") {
		q := strings.Split(strings.Split(rawURL, "?")[1], "&")
		for _, part := range q {
			name, value, _ := strings.Cut(part, "=")
			query = append(query, NVP{Name: name, Value: value})
		}
	}
	return Entry{
		Request: Request{
			Method:      "GET",
			URL:         rawURL,
			Headers:     headers,
			PostData:    post,
			QueryString: query,
		},
		Response: Response{
			Status:  200,
			Headers: headers,
			Content: Content{MimeType: contentType, Text: body},
		},
	}
}

func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	old := os.Stdout
	os.Stdout = w
	fn()
	_ = w.Close()
	os.Stdout = old
	var buf bytes.Buffer
	if _, err := io.Copy(&buf, r); err != nil {
		t.Fatal(err)
	}
	return buf.String()
}
