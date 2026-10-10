package mcp

import (
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
)

// TestNamingLock encodes docs/mcp-naming.md for this module. See the math
// naming test for the rule list. The implementation ServerName is the binary
// google-health-mcp; the lock id is google-health.

const serverID = "google-health"

// TODO(naming): tools that violate docs/mcp-naming.md. Do not rename them —
// eval fixtures and the harness depend on the published names. Delete an
// entry only when that tool is actually renamed; a new violation must fail.
var namingAllowlist = map[string]string{}

// TODO(naming): argument paths that are not snake_case. Same rule as above.
var argAllowlist = map[string]string{}

func TestNamingLock(t *testing.T) {
	checkNamingLock(t, catalogTools(t, map[string]any{
		"sleep_get":       sleepGetInput{},
		"activities_list": activitiesListInput{},
		"activities_get":  activitiesGetInput{},
		"heart_rate_get":  heartRateGetInput{},
		"hrv_get":         hrvGetInput{},
		"weight_get":      weightGetInput{},
		"profile_get":     profileGetInput{},
		"account_get":     accountGetInput{},
	}), namingAllowlist, argAllowlist)
}

type lockedTool struct {
	name string
	args []string
}

var (
	serverIDRe   = regexp.MustCompile(`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`)
	toolPrefixRe = regexp.MustCompile(`^[a-z]+_[a-z]+`)
	toolNameRe   = regexp.MustCompile(`^[a-z]+(_[a-z]+)+$`)
	argNameRe    = regexp.MustCompile(`^[a-z][a-z0-9]*(_[a-z0-9]+)*$`)
)

// guideCanonical names are the shapes docs/mcp-naming.md lists even when the
// verb is not its own token (route_eta is leave-by).
var guideCanonical = map[string]bool{
	"route_eta": true,
}

func checkNamingLock(t *testing.T, tools []lockedTool, toolAllow, argAllow map[string]string) {
	t.Helper()
	if !serverIDRe.MatchString(serverID) {
		t.Fatalf("server id %q does not match ^[a-z][a-z0-9]*(-[a-z0-9]+)*$", serverID)
	}
	if len(tools) == 0 {
		t.Fatal("no tools registered")
	}

	seen := map[string]bool{}
	for _, tool := range tools {
		if seen[tool.name] {
			t.Errorf("duplicate tool %q", tool.name)
		}
		seen[tool.name] = true

		reasons := toolNameViolations(serverID, tool.name)
		_, allowed := toolAllow[tool.name]
		switch {
		case len(reasons) == 0 && allowed:
			t.Errorf("allowlist entry %q follows the guide now; remove it", tool.name)
		case len(reasons) > 0 && !allowed:
			t.Errorf("tool %q violates naming: %s", tool.name, strings.Join(reasons, "; "))
		}

		for _, arg := range tool.args {
			if argNameRe.MatchString(argKey(arg)) {
				continue
			}
			full := tool.name + " " + arg
			if _, ok := argAllow[full]; !ok {
				t.Errorf("arg %q is not snake_case", full)
			}
		}
	}

	for name := range toolAllow {
		if !seen[name] {
			t.Errorf("allowlist entry %q is not a registered tool", name)
		}
	}
	for full := range argAllow {
		toolName, arg, ok := strings.Cut(full, " ")
		if !ok || !seen[toolName] || !containsArg(tools, toolName, arg) || argNameRe.MatchString(argKey(arg)) {
			t.Errorf("arg allowlist %q is not a current violation", full)
		}
	}
}

func containsArg(tools []lockedTool, name, arg string) bool {
	for _, tool := range tools {
		if tool.name != name {
			continue
		}
		for _, got := range tool.args {
			if got == arg {
				return true
			}
		}
	}
	return false
}

func toolNameViolations(id, name string) []string {
	var reasons []string
	if !toolPrefixRe.MatchString(name) || !toolNameRe.MatchString(name) {
		reasons = append(reasons, "want {service}_{verb}_{object…} matching ^[a-z]+_[a-z]+")
	}
	if startsWithServerID(id, name) {
		reasons = append(reasons, "starts with server id "+id)
	}
	reasons = append(reasons, domainViolations(id, name)...)
	if guideCanonical[name] {
		return reasons
	}
	parts := strings.Split(name, "_")
	if len(parts) < 2 {
		return reasons
	}
	hasVerb := false
	for _, part := range parts[1:] {
		if verbOK(part) {
			hasVerb = true
			break
		}
	}
	if !hasVerb {
		reasons = append(reasons, "no stable verb after the service (list|get|search|create|update|delete|format)")
	}
	if stableVerb(parts[0]) && !verbOK(parts[1]) {
		reasons = append(reasons, "verb-first; the service token should lead")
	}
	return reasons
}

func startsWithServerID(id, name string) bool {
	forms := []string{id}
	if underscored := strings.ReplaceAll(id, "-", "_"); underscored != id {
		forms = append(forms, underscored)
	}
	for _, form := range forms {
		if strings.HasPrefix(name, form) {
			return true
		}
	}
	return false
}

func domainViolations(id, name string) []string {
	var reasons []string
	switch id {
	case "garmin", "strava":
		if strings.HasPrefix(name, "calendar_") {
			reasons = append(reasons, "calendar_ steals Google Calendar; use training_calendar_")
		}
		if strings.HasPrefix(name, "mail_") {
			reasons = append(reasons, "mail_ belongs on google")
		}
	case "boards":
		for _, prefix := range []string{"profile_", "posts_", "activities_", "calendar_"} {
			if strings.HasPrefix(name, prefix) {
				reasons = append(reasons, prefix+" belongs to another plugin; boards uses roster_/notices_/challenges_")
			}
		}
	case "image":
		if strings.HasPrefix(name, "image_") {
			reasons = append(reasons, "image_ repeats the server id; use photo_")
		}
	case "twitter":
		if strings.HasPrefix(name, "tweets_") {
			reasons = append(reasons, "use posts_ not tweets_")
		}
	case "youtube":
		if strings.HasPrefix(name, "tracks_") {
			reasons = append(reasons, "use videos_ not tracks_")
		}
	case "search":
		if strings.HasPrefix(name, "web_") {
			reasons = append(reasons, "web_ is the harness builtin web_search, not a plugin tool")
		}
	case "maps":
		if strings.HasPrefix(name, "short_url_") {
			reasons = append(reasons, "use link_resolve not short_url_")
		}
	case "chat":
		if strings.HasPrefix(name, "pendant") {
			reasons = append(reasons, "pendant_ is the old server id; use avatar_/backdrop_/theme_")
		}
	}
	return reasons
}

func verbOK(part string) bool {
	switch part {
	case "list", "get", "search", "create", "update", "delete", "format",
		"evaluate", "convert", "resolve", "beam", "generate", "edit":
		return true
	default:
		return false
	}
}

func stableVerb(part string) bool {
	switch part {
	case "list", "get", "search", "create", "update", "delete", "format":
		return true
	default:
		return false
	}
}

func argKey(path string) string {
	if i := strings.LastIndex(path, "."); i >= 0 {
		return path[i+1:]
	}
	return path
}

func jsonFieldPaths(sample any) []string {
	var out []string
	walkType(reflect.TypeOf(sample), "", &out)
	return out
}

func walkType(t reflect.Type, prefix string, out *[]string) {
	if t == nil {
		return
	}
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t.Kind() != reflect.Struct || t == reflect.TypeOf(time.Time{}) {
		return
	}
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if field.PkgPath != "" && !field.Anonymous {
			continue
		}
		tag := field.Tag.Get("json")
		name, _, _ := strings.Cut(tag, ",")
		if name == "" || name == "-" {
			continue
		}
		path := name
		if prefix != "" {
			path = prefix + "." + name
		}
		*out = append(*out, path)
		walkType(field.Type, path, out)
	}
}

func catalogTools(t *testing.T, catalog map[string]any) []lockedTool {
	t.Helper()
	registered := map[string]bool{}
	out := make([]lockedTool, 0, len(RegisteredToolNames()))
	for _, name := range RegisteredToolNames() {
		registered[name] = true
		sample, ok := catalog[name]
		if !ok {
			out = append(out, lockedTool{name: name, args: []string{"MISSING_SCHEMA"}})
			continue
		}
		out = append(out, lockedTool{name: name, args: jsonFieldPaths(sample)})
	}
	for name := range catalog {
		if !registered[name] {
			t.Errorf("catalog entry %q is not a registered tool", name)
		}
	}
	return out
}
