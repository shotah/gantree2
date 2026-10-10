package main

import (
	"encoding/json"
	"io"
)

func writeHostManifest(w io.Writer) error {
	return json.NewEncoder(w).Encode(map[string]any{
		"name":     "twitter",
		"command":  "twitter-mcp",
		"env_keys": []string{"X_BEARER_TOKEN"},
		"blurb":    "One bearer token.",
	})
}
