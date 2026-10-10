package testutil

import (
	"net/http"
	"strings"
	"testing"

	"gopkg.in/dnaeon/go-vcr.v4/pkg/cassette"
)

func TestSettingsPath(t *testing.T) {
	path := SettingsPath()
	if !strings.HasSuffix(filepathToSlash(path), "/settings.json") {
		t.Fatalf("SettingsPath() = %q, want .../settings.json", path)
	}
	if ModuleRoot() == "." {
		t.Fatal("ModuleRoot() failed; SettingsPath may be wrong")
	}
}

func TestModuleRootAndCassetteDir(t *testing.T) {
	root := ModuleRoot()
	if root == "" || root == "." {
		t.Fatalf("ModuleRoot() = %q, want a path containing go.mod", root)
	}
	dir := CassetteDir()
	if !strings.HasSuffix(filepathToSlash(dir), "testdata/cassettes") {
		t.Fatalf("CassetteDir() = %q, want .../testdata/cassettes", dir)
	}
}

func filepathToSlash(p string) string {
	return strings.ReplaceAll(p, `\`, "/")
}

func TestFakeSessionJSON(t *testing.T) {
	s := FakeSessionJSON()
	for _, want := range []string{
		`"oauth2_access_token"`,
		`"oauth2_refresh_token"`,
		`"2099-01-01T00:00:00Z"`,
		`"garmin.com"`,
	} {
		if !strings.Contains(s, want) {
			t.Errorf("FakeSessionJSON missing %s", want)
		}
	}
}

func TestRedactQueryParam(t *testing.T) {
	tests := []struct {
		name  string
		url   string
		param string
		want  string
	}{
		{
			name:  "end of query",
			url:   "https://example.com/login?ticket=ST-abc123",
			param: "ticket",
			want:  "https://example.com/login?ticket=[REDACTED]",
		},
		{
			name:  "middle of query",
			url:   "https://example.com/?ticket=ST-abc&next=/home",
			param: "ticket",
			want:  "https://example.com/?ticket=[REDACTED]&next=/home",
		},
		{
			name:  "missing param unchanged",
			url:   "https://example.com/?foo=bar",
			param: "ticket",
			want:  "https://example.com/?foo=bar",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := redactQueryParam(tt.url, tt.param)
			if got != tt.want {
				t.Errorf("redactQueryParam() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestExtractPath(t *testing.T) {
	tests := []struct {
		url  string
		want string
	}{
		{"https://connectapi.garmin.com/wellness-service/wellness/dailySleep?date=2026-01-01", "/wellness-service/wellness/dailySleep"},
		{"http://example.com/path", "/path"},
		{"not-a-url", "not-a-url"},
	}
	for _, tt := range tests {
		got := extractPath(tt.url)
		if got != tt.want {
			t.Errorf("extractPath(%q) = %q, want %q", tt.url, got, tt.want)
		}
	}
}

func TestSanitizeFormData(t *testing.T) {
	form := map[string][]string{
		"password": {"secret"},
		"username": {"user@example.com"},
		"ticket":   {"ST-123"},
		"keep":     {"ok"},
	}
	sanitizeFormData(form)
	for _, field := range []string{"password", "username", "ticket"} {
		if form[field][0] != "[REDACTED]" {
			t.Errorf("%s = %v, want [REDACTED]", field, form[field])
		}
	}
	if form["keep"][0] != "ok" {
		t.Errorf("keep = %v, want ok", form["keep"])
	}
}

func TestAnonymizeBody(t *testing.T) {
	body := `{
		"userProfilePK":99999999,
		"displayName":"real-user",
		"email":"real@example.com",
		"access_token":"tok",
		"refresh_token":"ref",
		"deviceId":555,
		"courseId":777,
		"latitude":1.23,
		"longitude":4.56
	}`
	got := anonymizeBody(body)
	checks := []string{
		`"userProfilePK":12345678`,
		`"displayName":"anonymous"`,
		`"email":"anonymous@example.com"`,
		`"access_token":"[REDACTED]"`,
		`"refresh_token":"[REDACTED]"`,
		`"deviceId":12345678`,
		`"courseId":87654321`,
		`"latitude":48.8566`,
		`"longitude":2.3522`,
	}
	for _, want := range checks {
		if !strings.Contains(got, want) {
			t.Errorf("anonymizeBody missing %s\ngot: %s", want, got)
		}
	}
}

func TestFlexibleMatcher(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "https://connectapi.garmin.com/api/foo?x=1", http.NoBody)
	if err != nil {
		t.Fatal(err)
	}
	if !flexibleMatcher(req, cassette.Request{
		Method: http.MethodGet,
		URL:    "https://connectapi.garmin.com/api/foo?y=2",
	}) {
		t.Error("expected path match ignoring query")
	}
	if flexibleMatcher(req, cassette.Request{
		Method: http.MethodPost,
		URL:    "https://connectapi.garmin.com/api/foo",
	}) {
		t.Error("expected method mismatch")
	}
	if flexibleMatcher(req, cassette.Request{
		Method: http.MethodGet,
		URL:    "https://connectapi.garmin.com/api/bar",
	}) {
		t.Error("expected path mismatch")
	}
}

func TestSanitizeHook(t *testing.T) {
	i := &cassette.Interaction{
		Request: cassette.Request{
			URL:    "https://connectapi.garmin.com/usersummary-service/usersummary/daily/5b0c5ea2-a3e7-4e96-aa76-bf712f20780a?calendarDate=2026-07-15",
			Body:   `password=hunter2`,
			Method: http.MethodGet,
			Form: map[string][]string{
				"password": {"hunter2"},
			},
			Headers: http.Header{
				"Authorization":     []string{"Bearer secret"},
				"Cookie":            []string{"session=abc"},
				"X-Vcap-Request-Id": []string{"31d3a749-ebb6-4061-55ed-cca021"},
			},
		},
		Response: cassette.Response{
			Body: `{"displayName":"real","access_token":"tok","activityName":"Seattle Running","activityUUID":"9b43d3b5-eb63-405f-ac3e-606057803010","jti":"abc"}`,
			Headers: http.Header{
				"Set-Cookie": []string{"session=abc"},
			},
		},
	}
	if err := sanitizeHook(i); err != nil {
		t.Fatal(err)
	}
	if i.Request.Headers.Get("Authorization") != "[REDACTED]" {
		t.Errorf("Authorization = %q", i.Request.Headers.Get("Authorization"))
	}
	if i.Request.Headers.Get("Cookie") != "[REDACTED]" {
		t.Errorf("Cookie = %q", i.Request.Headers.Get("Cookie"))
	}
	if i.Request.Headers.Get("X-Vcap-Request-Id") != "[REDACTED]" {
		t.Errorf("X-Vcap-Request-Id = %q", i.Request.Headers.Get("X-Vcap-Request-Id"))
	}
	if i.Response.Headers.Get("Set-Cookie") != "[REDACTED]" {
		t.Errorf("Set-Cookie = %q", i.Response.Headers.Get("Set-Cookie"))
	}
	if i.Request.Body != "[REDACTED]" {
		t.Errorf("Body = %q", i.Request.Body)
	}
	if !strings.Contains(i.Request.URL, "/usersummary/daily/anonymous?") {
		t.Errorf("URL = %q", i.Request.URL)
	}
	for _, want := range []string{
		`"displayName":"anonymous"`,
		`"activityName":"Anonymous Activity"`,
		`"activityUUID":"` + zeroUUID + `"`,
		`"jti":"` + zeroUUID + `"`,
	} {
		if !strings.Contains(i.Response.Body, want) {
			t.Errorf("Response.Body missing %s\nbody: %s", want, i.Response.Body)
		}
	}
}
