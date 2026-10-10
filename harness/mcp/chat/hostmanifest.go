package main

import (
	"encoding/json"
	"io"

	"github.com/shotah/pendant-mcp/tools"
)

func writeHostManifest(w io.Writer) error {
	return encodeHostManifest(w)
}

func encodeHostManifest(w io.Writer) error {
	return json.NewEncoder(w).Encode(map[string]any{
		"name":              "chat",
		"command":           "chat",
		"env_keys":          []string{},
		"optional_env_keys": tools.OptionalEnvKeys(),
		"blurb":             tools.HostManifestBlurb,
	})
}
