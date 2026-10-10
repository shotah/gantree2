package tools

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func writeOutput(data []byte, getenv func(string) string) (string, error) {
	dir := strings.TrimSpace(getenv(EnvImageOutputDir))
	if dir == "" {
		return "", nil
	}
	dir = filepath.Clean(dir)
	if dir == "." || strings.Contains(dir, "..") {
		return "", fmt.Errorf("%s must be a concrete directory", EnvImageOutputDir)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil { //nolint:gosec // G703: IMAGE_OUTPUT_DIR is operator-set
		return "", fmt.Errorf("IMAGE_OUTPUT_DIR: %w", err)
	}
	name := fmt.Sprintf("%d.jpg", time.Now().UTC().UnixNano())
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0o600); err != nil { //nolint:gosec // G703: path is IMAGE_OUTPUT_DIR + generated name
		return "", fmt.Errorf("IMAGE_OUTPUT_DIR: %w", err)
	}
	return path, nil
}
