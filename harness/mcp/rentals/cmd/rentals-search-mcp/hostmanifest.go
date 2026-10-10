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
		"name":     "rentals",
		"command":  "rentals-search-mcp",
		"env_keys": []string{"RENTCAST_API_KEY"},
		"blurb":    "US listings. One RentCast key.",
	})
}
