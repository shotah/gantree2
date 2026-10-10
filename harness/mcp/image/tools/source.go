package tools

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

func imageRoots() []string {
	var roots []string
	for _, key := range []string{EnvImageOutputDir, EnvPendantImageDir} {
		if dir := strings.TrimSpace(os.Getenv(key)); dir != "" {
			roots = append(roots, dir)
		}
	}
	return roots
}

func readEditSource(sourcePath, sourceImage, sourceMIME string) (data []byte, mime string, err error) {
	path := strings.TrimSpace(sourcePath)
	img := strings.TrimSpace(sourceImage)
	if path != "" && img != "" {
		return nil, "", errors.New("pass exactly one of source_path or source_image. " + nextEdit)
	}
	if path == "" && img == "" {
		if len(imageRoots()) == 0 {
			return nil, "", errNeedImageDir()
		}
		return nil, "", errors.New("source_path is required. " + nextEdit)
	}
	if img != "" {
		data, err = decodeSourceImage(img)
		if err != nil {
			return nil, "", err
		}
		mime = strings.TrimSpace(sourceMIME)
		if mime == "" {
			mime = mimePNG
		}
		return data, mime, nil
	}
	data, err = readSourcePath(path)
	if err != nil {
		return nil, "", err
	}
	mime = strings.TrimSpace(sourceMIME)
	if mime == "" {
		mime = mimeFromPath(path)
	}
	return data, mime, nil
}

func readSourcePath(raw string) ([]byte, error) {
	roots := imageRoots()
	if len(roots) == 0 {
		return nil, errNeedImageDir()
	}
	resolved, err := resolveInsideRoots(raw, roots)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(resolved) //nolint:gosec // G304: path is realpath-checked against IMAGE_OUTPUT_DIR / PENDANT_IMAGE_DIR
	if err != nil {
		return nil, errors.New("source_path could not be read. " + nextEdit)
	}
	if len(data) == 0 {
		return nil, errors.New("source_path is empty. " + nextEdit)
	}
	return data, nil
}

func resolveInsideRoots(raw string, roots []string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("source_path is required. " + nextEdit)
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

func mimeFromPath(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	default:
		return mimePNG
	}
}

func errNeedImageDir() error {
	return errors.New(EnvImageOutputDir + " is required for source_path (the pendant__avatar_get / photo_generate handoff). " + nextEdit)
}

func errRefusePath() error {
	return errors.New("source_path must resolve inside " + EnvImageOutputDir + " (or " + EnvPendantImageDir + "). " + nextEdit)
}
