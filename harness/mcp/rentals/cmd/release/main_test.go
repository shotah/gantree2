package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNextVersion(t *testing.T) {
	t.Parallel()

	cases := []struct {
		current, bump, explicit, want string
	}{
		{"", "patch", "", "v0.0.1"},
		{"v0.0.1", "patch", "", "v0.0.2"},
		{"v0.0.9", "minor", "", "v0.1.0"},
		{"v1.2.3", "major", "", "v2.0.0"},
		{"v1.2.3", "patch", "v9.8.7", "v9.8.7"},
		{"v1.2.3", "patch", "1.0.0", "v1.0.0"},
		{"v0.1.0", "", "", "v0.1.1"},
	}
	for _, tc := range cases {
		got, err := nextVersion(tc.current, tc.bump, tc.explicit)
		if err != nil {
			t.Fatalf("nextVersion(%q,%q,%q): %v", tc.current, tc.bump, tc.explicit, err)
		}
		if got != tc.want {
			t.Fatalf("got %q want %q", got, tc.want)
		}
	}
}

func TestNextVersionErrors(t *testing.T) {
	t.Parallel()

	if _, err := nextVersion("v1.2.3", "sideways", ""); err == nil {
		t.Fatal("expected invalid bump error")
	}
	if _, err := nextVersion("v1.2.3", "patch", "nope"); err == nil {
		t.Fatal("expected invalid explicit version error")
	}
	if _, err := nextVersion("not-semver", "patch", ""); err == nil {
		t.Fatal("expected invalid current tag error")
	}
}

func TestDisplayTag(t *testing.T) {
	t.Parallel()
	if got := displayTag(""); got != "(none)" {
		t.Fatalf("got %q", got)
	}
	if got := displayTag("v1.2.3"); got != "v1.2.3" {
		t.Fatalf("got %q", got)
	}
}

func TestModuleRoot(t *testing.T) {
	root, err := moduleRoot()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err != nil {
		t.Fatalf("go.mod missing under %s: %v", root, err)
	}
}

func TestModuleRootNotFound(t *testing.T) {
	tmp := t.TempDir()
	prev, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(tmp); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(prev) })

	if _, err := moduleRoot(); err == nil {
		t.Fatal("expected error when go.mod missing")
	}
}

func TestGitOutputAndRun(t *testing.T) {
	t.Parallel()
	out := gitOutput("rev-parse", "--is-inside-work-tree")
	if strings.TrimSpace(out) == "" {
		t.Skip("not a git work tree yet — run git init when ready to publish")
	}
	if out := gitOutput("not-a-real-git-subcommand-xyz"); out != "" {
		t.Fatalf("expected empty on failure, got %q", out)
	}
	if err := gitRun("status", "--porcelain"); err != nil {
		t.Fatalf("gitRun: %v", err)
	}
}

func TestLatestTag(t *testing.T) {
	t.Helper()
	// May be empty on a fresh / untagged repo; just ensure it does not panic.
	tag := latestTag()
	t.Logf("latestTag=%q", tag)
}

func TestFatalf(t *testing.T) {
	prev := exitFunc
	var code int
	exitFunc = func(c int) { code = c }
	t.Cleanup(func() { exitFunc = prev })

	fatalf("hello %s", "world")
	if code != 1 {
		t.Fatalf("exit code %d", code)
	}
}

func TestRunDryRun(t *testing.T) {
	code := run([]string{"-dry-run"})
	if code != 0 {
		t.Fatalf("exit %d", code)
	}
}

func TestRunBadFlag(t *testing.T) {
	t.Parallel()
	code := run([]string{"-nope"})
	if code != 2 {
		t.Fatalf("exit %d want 2", code)
	}
}

func TestRunInvalidBump(t *testing.T) {
	prev := exitFunc
	exitFunc = func(int) {}
	t.Cleanup(func() { exitFunc = prev })

	code := run([]string{"-dry-run", "-bump=sideways"})
	// dry-run still validates nextVersion before printing; invalid bump → fatalf + 1
	if code != 1 {
		t.Fatalf("exit %d want 1", code)
	}
}
