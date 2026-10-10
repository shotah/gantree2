package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/shotah/go-garmin/garmin"
)

func sessionPath() string {
	if p := strings.TrimSpace(os.Getenv("GARMIN_SESSION_PATH")); p != "" {
		return p
	}
	// Gantry bind-mounts DATA_DIR. Distroless HOME is /home/nonroot (overlay),
	// so preferring DATA_DIR is what makes /auth garmin survive recreate.
	if data := strings.TrimSpace(os.Getenv("DATA_DIR")); data != "" {
		return filepath.Join(data, ".config", "garmin", "session.json")
	}
	configDir, err := os.UserConfigDir()
	if err != nil {
		configDir = os.Getenv("HOME")
	}
	return filepath.Join(configDir, "garmin", "session.json")
}

func loadClient() (*garmin.Client, error) {
	path := sessionPath()
	f, err := os.Open(path)
	if err != nil {
		return nil, errors.New("not logged in, run: garmin login")
	}
	defer f.Close()

	client := garmin.New(garmin.Options{})
	if err := client.LoadSession(f); err != nil {
		return nil, fmt.Errorf("session corrupted: %w", err)
	}
	// Persist rotated access/refresh tokens after automatic OAuth2 refresh so
	// MCP/CLI restarts keep working without an interactive re-login.
	client.SetSessionPersister(saveClient)
	return client, nil
}

func saveClient(client *garmin.Client) error {
	path := sessionPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}

	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()

	return client.SaveSession(f)
}

func removeSession() error {
	return os.Remove(sessionPath())
}
