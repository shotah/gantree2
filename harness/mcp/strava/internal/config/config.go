package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// Config holds application configuration loaded from environment variables.
type Config struct {
	ClientID     string
	ClientSecret string
	TokenPath    string
}

// Load reads configuration from environment variables and returns a Config.
// It validates that required variables are set and applies defaults for optional ones.
func Load() (*Config, error) {
	clientID := os.Getenv("STRAVA_CLIENT_ID")
	if clientID == "" {
		return nil, errors.New("STRAVA_CLIENT_ID environment variable is required. Get it from https://www.strava.com/settings/api")
	}

	clientSecret := os.Getenv("STRAVA_CLIENT_SECRET")
	if clientSecret == "" {
		return nil, errors.New("STRAVA_CLIENT_SECRET environment variable is required. Get it from https://www.strava.com/settings/api")
	}

	tokenPath := os.Getenv("STRAVA_TOKEN_PATH")
	if tokenPath == "" {
		tokenPath = defaultTokenPath()
	}

	return &Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		TokenPath:    tokenPath,
	}, nil
}

// defaultTokenPath prefers $DATA_DIR (gantry volume). Distroless HOME is
// /home/nonroot on the overlay, so ~/.strava would vanish on recreate.
func defaultTokenPath() string {
	if data := strings.TrimSpace(os.Getenv("DATA_DIR")); data != "" {
		return filepath.Join(data, ".strava", "tokens.json")
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return filepath.Join(".strava", "tokens.json")
	}
	return filepath.Join(home, ".strava", "tokens.json")
}
