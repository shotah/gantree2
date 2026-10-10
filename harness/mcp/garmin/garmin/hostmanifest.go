package garmin

import (
	"encoding/json"
	"io"
)

// WriteHostManifest prints the gantree / ai-gantry grant shape.
func WriteHostManifest(w io.Writer) error {
	return json.NewEncoder(w).Encode(map[string]any{
		"name":      "garmin",
		"command":   "garmin",
		"args":      []string{"mcp", "--tool-tier", "core"},
		"auth_args": []string{"login"},
		"auth_flow": "mfa",
		"env_keys":  []string{"GARMIN_EMAIL", "GARMIN_PASSWORD"},
		"blurb":     "Login + MFA paste. Do this last.",
	})
}
