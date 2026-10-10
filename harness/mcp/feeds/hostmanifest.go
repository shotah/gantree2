package main

import (
	"encoding/json"
	"io"
)

func writeHostManifest(w io.Writer) error {
	return json.NewEncoder(w).Encode(map[string]any{
		"name":     "feeds",
		"command":  "feeds-mcp",
		"env_keys": []string{"FEEDS_USER_AGENT"},
		"blurb":    "Optional contact UA.",
	})
}
