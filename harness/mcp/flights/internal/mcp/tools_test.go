package mcp

import (
	"strings"
	"testing"
)

func TestRegisteredToolNames(t *testing.T) {
	t.Parallel()
	names := RegisteredToolNames()
	want := []string{
		"offers_search",
		"dates_search",
		"airports_search",
		"returns_search",
		"booking_options_get",
		"link_format",
		"account_get",
	}
	if len(names) != len(want) {
		t.Fatalf("got %d tools, want %d: %v", len(names), len(want), names)
	}
	for i, name := range names {
		if name != want[i] {
			t.Errorf("tool[%d]=%q want %q", i, name, want[i])
		}
		if strings.HasPrefix(name, "flights_") {
			t.Errorf("%q must not include server id prefix", name)
		}
		parts := strings.Split(name, "_")
		if len(parts) < 2 {
			t.Errorf("%q should be {service}_{verb}_{object…}", name)
		}
	}
}
