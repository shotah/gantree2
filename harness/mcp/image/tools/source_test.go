package tools

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestReadEditSourceFromPath(t *testing.T) {
	root := t.TempDir()
	t.Setenv(EnvImageOutputDir, root)
	path := filepath.Join(root, "face.jpg")
	if err := os.WriteFile(path, []byte("jpeg-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, mime, err := readEditSource(path, "", "")
	if err != nil || string(got) != "jpeg-bytes" || mime != "image/jpeg" {
		t.Fatalf("got %q mime=%q err=%v", got, mime, err)
	}
}

func TestReadEditSourceRefusesOutsideRoot(t *testing.T) {
	t.Setenv(EnvImageOutputDir, t.TempDir())
	if _, _, err := readEditSource("/etc/hostname", "", ""); err == nil {
		t.Fatal("want refuse /etc/hostname")
	}
}

func TestReadEditSourceNeedsDir(t *testing.T) {
	t.Setenv(EnvImageOutputDir, "")
	t.Setenv(EnvPendantImageDir, "")
	if _, _, err := readEditSource("/tmp/x.png", "", ""); err == nil {
		t.Fatal("want IMAGE_OUTPUT_DIR teach-in")
	}
}

func TestReadEditSourceExactlyOne(t *testing.T) {
	t.Setenv(EnvImageOutputDir, t.TempDir())
	if _, _, err := readEditSource("a", "b", ""); err == nil {
		t.Fatal("want exactly one")
	}
}

func TestReadEditSourceImageStillWorks(t *testing.T) {
	t.Setenv(EnvImageOutputDir, "")
	raw := base64.StdEncoding.EncodeToString([]byte("from-b64"))
	got, mime, err := readEditSource("", raw, "")
	if err != nil || string(got) != "from-b64" || mime != mimePNG {
		t.Fatalf("got %q mime=%q err=%v", got, mime, err)
	}
}

func TestMimeFromPath(t *testing.T) {
	t.Parallel()
	if mimeFromPath("a.JPG") != "image/jpeg" {
		t.Fatal("jpg")
	}
	if mimeFromPath("a.webp") != "image/webp" {
		t.Fatal("webp")
	}
	if mimeFromPath("a.png") != mimePNG {
		t.Fatal("png")
	}
}
