package tools

import (
	"encoding/json"
	"strings"
	"testing"

	customsearch "google.golang.org/api/customsearch/v1"
)

func TestValueOrDefault(t *testing.T) {
	t.Parallel()
	if got := valueOrDefault("", "fallback"); got != "fallback" {
		t.Fatalf("got %q", got)
	}
	if got := valueOrDefault("value", "fallback"); got != "value" {
		t.Fatalf("got %q", got)
	}
}

func TestFormatCustomSearchResults(t *testing.T) {
	t.Parallel()
	pagemap, err := json.Marshal(map[string]any{
		"metatags": []any{
			map[string]any{
				"og:type":                "article",
				"article:published_time": "2026-01-15T12:00:00Z",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	got := formatCustomSearchResults([]*customsearch.Result{
		{Title: "", Link: "", Snippet: "line1\nline2", Pagemap: pagemap},
		{Title: "Title", Link: "https://example.com", Snippet: "ok"},
	}, 1)
	if !strings.Contains(got, "1. No title") {
		t.Fatalf("missing defaults:\n%s", got)
	}
	if !strings.Contains(got, "Snippet: line1 line2") {
		t.Fatalf("expected newline flattening:\n%s", got)
	}
	if !strings.Contains(got, "Type: article") || !strings.Contains(got, "Published: 2026-01-15") {
		t.Fatalf("missing metadata:\n%s", got)
	}
	if !strings.Contains(got, "2. Title") {
		t.Fatalf("missing second result:\n%s", got)
	}
}

func TestFormatSearchFacets(t *testing.T) {
	t.Parallel()
	if formatSearchFacets(nil) != "" {
		t.Fatal("expected empty for nil")
	}
	got := formatSearchFacets([]any{
		[]any{
			map[string]any{"label": "Docs", "anchor": "docs"},
			map[string]any{"label": "", "anchor": ""},
		},
		"skip-me",
	})
	if !strings.Contains(got, "- Docs (anchor: docs)") {
		t.Fatalf("missing facet:\n%s", got)
	}
	if !strings.Contains(got, "- Unknown (anchor: Unknown)") {
		t.Fatalf("missing defaults:\n%s", got)
	}
}

func TestFormatSearchResultMetadata(t *testing.T) {
	t.Parallel()
	if formatSearchResultMetadata(nil) != "" {
		t.Fatal("expected empty for nil")
	}
	if formatSearchResultMetadata([]byte(`{`)) != "" {
		t.Fatal("expected empty for invalid json")
	}
}
