package main

import (
	"encoding/json"
	"os"
)

func writeHostManifest() int {
	if err := json.NewEncoder(os.Stdout).Encode(map[string]any{
		"name":     "math",
		"command":  "mcp-go-math",
		"env_keys": []string{},
		"blurb":    "No secrets. Slim default.",
	}); err != nil {
		return 1
	}
	return 0
}
