package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
)

func writeHostManifest() int {
	if err := encodeHostManifest(os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "host-manifest: %v\n", err)
		return 1
	}
	return 0
}

func encodeHostManifest(w io.Writer) error {
	return json.NewEncoder(w).Encode(map[string]any{
		"name":      "google-health",
		"command":   "google-health-mcp",
		"auth_args": []string{"auth"},
		"auth_flow": "pkce",
		"env_keys":  []string{"GOOGLE_HEALTH_CLIENT_ID", "GOOGLE_HEALTH_CLIENT_SECRET"},
		"blurb":     "Sleep, activity, recovery. Client id/secret, then OAuth hop.",
	})
}
