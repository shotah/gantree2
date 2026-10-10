package tools

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func readSource(sourcePath, sourceImage string, roots []string) ([]byte, error) {
	path := strings.TrimSpace(sourcePath)
	img := strings.TrimSpace(sourceImage)
	if path != "" && img != "" {
		return nil, errors.New("pass exactly one of source_path or source_image. " + nextAvatarUpdate)
	}
	if path == "" && img == "" {
		if len(roots) == 0 {
			return nil, errNeedImageDir()
		}
		return nil, errors.New("source_path is required. " + nextAvatarUpdate)
	}
	if img != "" {
		return decodeSourceImage(img)
	}
	return readSourcePath(path, roots)
}

func readSourcePath(raw string, roots []string) ([]byte, error) {
	if len(roots) == 0 {
		return nil, errNeedImageDir()
	}
	resolved, err := resolveInsideRoots(raw, roots)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(resolved) //nolint:gosec // G304: path is realpath-checked against IMAGE_OUTPUT_DIR / PENDANT_IMAGE_DIR
	if err != nil {
		return nil, errors.New("source_path could not be read. " + nextAvatarUpdate)
	}
	if len(data) == 0 {
		return nil, errors.New("source_path is empty. " + nextAvatarUpdate)
	}
	return data, nil
}

func resolveInsideRoots(raw string, roots []string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("source_path is required. " + nextAvatarUpdate)
	}
	abs, err := filepath.Abs(raw)
	if err != nil {
		return "", errRefusePath()
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", errRefusePath()
	}
	info, err := os.Stat(resolved)
	if err != nil || !info.Mode().IsRegular() {
		return "", errRefusePath()
	}
	for _, root := range roots {
		ok, err := pathInsideRoot(resolved, root)
		if err != nil {
			continue
		}
		if ok {
			return resolved, nil
		}
	}
	return "", errRefusePath()
}

func pathInsideRoot(resolved, root string) (bool, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return false, errRefusePath()
	}
	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return false, err
	}
	rootResolved, err := filepath.EvalSymlinks(rootAbs)
	if err != nil {
		return false, err
	}
	rel, err := filepath.Rel(rootResolved, resolved)
	if err != nil {
		return false, err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false, nil
	}
	return true, nil
}

func decodeSourceImage(raw string) ([]byte, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("source_image is empty. " + nextAvatarUpdate)
	}
	if i := strings.Index(raw, ","); i >= 0 && strings.Contains(strings.ToLower(raw[:i]), "base64") {
		raw = raw[i+1:]
	}
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		data, err = base64.RawStdEncoding.DecodeString(raw)
	}
	if err != nil {
		return nil, errors.New("source_image must be base64. " + nextAvatarUpdate)
	}
	if len(data) == 0 {
		return nil, errors.New("source_image is empty. " + nextAvatarUpdate)
	}
	return data, nil
}

func errRefusePath() error {
	return errors.New("source_path must resolve inside " + EnvImageOutputDir + " (or " + EnvPendantImageDir + "). " + nextAvatarUpdate)
}
