package main

import (
	"encoding/json"
	"io"

	"github.com/shotah/image-generation-mcp/tools"
)

func writeHostManifest(w io.Writer) error {
	return encodeHostManifest(w)
}

func encodeHostManifest(w io.Writer) error {
	return json.NewEncoder(w).Encode(map[string]any{
		"name":              "image",
		"command":           "image-generation-mcp",
		"env_keys":          []string{},
		"optional_env_keys": tools.OptionalEnvKeys(),
		"blurb":             tools.HostManifestBlurb,
	})
}
