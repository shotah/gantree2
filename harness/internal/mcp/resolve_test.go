package mcp

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveExecutableUsesBakedBinary(t *testing.T) {
	root := t.TempDir()
	old := mcpOptRoot
	mcpOptRoot = root
	t.Cleanup(func() { mcpOptRoot = old })

	dir := filepath.Join(root, "feeds")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	baked := filepath.Join(dir, "feeds")
	if err := os.WriteFile(baked, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	got, err := resolveExecutable(ServerSpec{Name: "feeds", Command: "feeds-mcp"}, "feeds-mcp")
	if err != nil {
		t.Fatal(err)
	}
	if got != baked {
		t.Fatalf("got %q want %q", got, baked)
	}
}

func TestResolveExecutableAbsoluteCommandSkipsBaked(t *testing.T) {
	root := t.TempDir()
	old := mcpOptRoot
	mcpOptRoot = root
	t.Cleanup(func() { mcpOptRoot = old })

	dir := filepath.Join(root, "feeds")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	baked := filepath.Join(dir, "feeds")
	if err := os.WriteFile(baked, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	abs := filepath.Join(t.TempDir(), "custom")
	if err := os.WriteFile(abs, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	got, err := resolveExecutable(ServerSpec{Name: "feeds", Command: abs}, abs)
	if err != nil {
		t.Fatal(err)
	}
	if got == baked {
		t.Fatalf("absolute command resolved to baked path %s", baked)
	}
}

func TestResolveExecutableMissingBareName(t *testing.T) {
	_, err := resolveExecutable(ServerSpec{Name: "gone", Command: "gantry-test-missing-mcp-binary-xyz"}, "gantry-test-missing-mcp-binary-xyz")
	if err == nil {
		t.Fatal("expected missing binary")
	}
}

func TestResolveExecutableRejectsDotDotName(t *testing.T) {
	if bakedPluginPath("..") != "" || bakedPluginPath("../tmp") != "" || bakedPluginPath("a/b") != "" {
		t.Fatal("baked path accepted a non-id")
	}
}

func TestRunAuthOutputUsesBakedBinary(t *testing.T) {
	root := t.TempDir()
	old := mcpOptRoot
	mcpOptRoot = root
	t.Cleanup(func() { mcpOptRoot = old })

	dir := filepath.Join(root, "strava")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\nprintf 'open https://x.test\\n'\n"
	if err := os.WriteFile(filepath.Join(dir, "strava"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	spec := ServerSpec{Name: "strava", Command: "strava-mcp", AuthArgs: []string{"auth"}}
	stdout, stderr, err := RunAuthOutput(t.Context(), spec, []string{"url"})
	if err != nil {
		t.Fatalf("stdout=%q stderr=%q err=%v", stdout, stderr, err)
	}
	if stdout != "open https://x.test" {
		t.Fatalf("stdout=%q", stdout)
	}
}
