package tools

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func writeOutput(got Result) (string, error) {
	dir := strings.TrimSpace(os.Getenv(EnvImageOutputDir))
	if dir == "" {
		return "", nil
	}
	dir = filepath.Clean(dir)
	if dir == "." || strings.Contains(dir, "..") {
		return "", fmt.Errorf("%s must be a concrete directory", EnvImageOutputDir)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil { //nolint:gosec // G703: IMAGE_OUTPUT_DIR is operator-set, not a tool argument
		return "", fmt.Errorf("IMAGE_OUTPUT_DIR: %w", err)
	}
	ext := ".png"
	switch strings.ToLower(got.MIME) {
	case "image/jpeg", "image/jpg":
		ext = ".jpg"
	case "image/webp":
		ext = ".webp"
	case "image/gif":
		ext = ".gif"
	}
	name := fmt.Sprintf("%d%s", time.Now().UTC().UnixNano(), ext)
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, got.Data, 0o600); err != nil { //nolint:gosec // G703: path is IMAGE_OUTPUT_DIR + generated filename
		return "", fmt.Errorf("IMAGE_OUTPUT_DIR: %w", err)
	}
	return path, nil
}
