package tools

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestReadSourcePathInsideRoot(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "shot.png")
	if err := os.WriteFile(path, []byte("png-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := readSource(path, "", []string{root})
	if err != nil || string(got) != "png-bytes" {
		t.Fatalf("got %q err=%v", got, err)
	}
}

func TestReadSourcePathOutsideRoot(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()
	path := filepath.Join(other, "secret")
	if err := os.WriteFile(path, []byte("nope"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readSource(path, "", []string{root}); err == nil {
		t.Fatal("want refuse")
	}
	if _, err := readSource("/etc/hostname", "", []string{root}); err == nil {
		t.Fatal("want refuse /etc/hostname")
	}
}

func TestReadSourceNeedsDir(t *testing.T) {
	if _, err := readSource("/tmp/x.png", "", nil); err == nil {
		t.Fatal("want IMAGE_OUTPUT_DIR teach-in")
	}
}

func TestReadSourceExactlyOne(t *testing.T) {
	if _, err := readSource("a", "b", []string{"/tmp"}); err == nil {
		t.Fatal("want exactly one")
	}
}

func TestDecodeSourceImage(t *testing.T) {
	t.Parallel()
	raw := base64.StdEncoding.EncodeToString([]byte("hello"))
	got, err := decodeSourceImage(raw)
	if err != nil || string(got) != "hello" {
		t.Fatalf("got %q err=%v", got, err)
	}
	got, err = decodeSourceImage("data:image/png;base64," + raw)
	if err != nil || string(got) != "hello" {
		t.Fatalf("data url %q err=%v", got, err)
	}
	if _, err := decodeSourceImage("not-base64!!!"); err == nil {
		t.Fatal("junk should fail")
	}
}

func TestReadSourceImageArg(t *testing.T) {
	raw := base64.StdEncoding.EncodeToString([]byte("from-b64"))
	got, err := readSource("", raw, nil)
	if err != nil || string(got) != "from-b64" {
		t.Fatalf("got %q err=%v", got, err)
	}
}
