package tools

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteOutputSkipsWhenUnset(t *testing.T) {
	path, err := writeOutput([]byte("jpg"), func(string) string { return "" })
	if err != nil || path != "" {
		t.Fatalf("path=%q err=%v", path, err)
	}
}

func TestWriteOutputWritesFile(t *testing.T) {
	dir := t.TempDir()
	path, err := writeOutput([]byte("jpg-bytes"), func(key string) string {
		if key == EnvImageOutputDir {
			return dir
		}
		return ""
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(path, dir) {
		t.Fatalf("path %q not under %s", path, dir)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "jpg-bytes" {
		t.Fatalf("file = %q", got)
	}
	if filepath.Ext(path) != ".jpg" {
		t.Fatalf("ext = %s", filepath.Ext(path))
	}
}

func TestWriteOutputRejectsDotDot(t *testing.T) {
	_, err := writeOutput([]byte("jpg"), func(key string) string {
		if key == EnvImageOutputDir {
			return "../nope"
		}
		return ""
	})
	if err == nil {
		t.Fatal("want error for ..")
	}
}
