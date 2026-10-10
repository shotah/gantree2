package tools

import (
	"strings"
	"testing"

	script "google.golang.org/api/script/v1"
)

func TestFormatScriptFiles(t *testing.T) {
	t.Parallel()
	got := formatScriptFiles([]*script.File{
		{Name: "Code", Type: "SERVER_JS", Source: "function main() {}"},
		{Name: "", Type: "", Source: strings.Repeat("x", 250)},
	})
	if !strings.Contains(got, "1. Code (SERVER_JS)") {
		t.Fatalf("missing first file header:\n%s", got)
	}
	if !strings.Contains(got, "2. Untitled (Unknown)") {
		t.Fatalf("missing untitled/unknown defaults:\n%s", got)
	}
	if !strings.Contains(got, "...") {
		t.Fatalf("expected truncated source:\n%s", got)
	}
	if formatScriptFiles(nil) != "\nFiles:\n" {
		t.Fatalf("unexpected empty files output: %q", formatScriptFiles(nil))
	}
}
