package agent_test

// Sibling MCP catalogs for the behavioral eval. tools_from names a server;
// mcp.lock names the module in this repo. The integration test builds that
// module and boots it. There is no release download.

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// mcpLockRow is one plugin in harness/mcp.lock.
type mcpLockRow struct {
	ID     string
	Path   string
	Module string
	Binary string
	Needs  string
}

// parseMCPLock reads the tab-separated lock. Lines are
// id, path, module, binary, needs, and an optional home_only column.
func parseMCPLock(data string) (map[string]mcpLockRow, error) {
	rows := map[string]mcpLockRow{}
	for i, line := range strings.Split(data, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) < 5 {
			return nil, fmt.Errorf("mcp.lock:%d: want id, path, module, binary, needs", i+1)
		}
		row := mcpLockRow{
			ID:     fields[0],
			Path:   fields[1],
			Module: fields[2],
			Binary: fields[3],
			Needs:  fields[4],
		}
		if row.ID == "" || row.Path == "" || row.Binary == "" {
			return nil, fmt.Errorf("mcp.lock:%d: id, path, and binary are required", i+1)
		}
		if _, ok := rows[row.ID]; ok {
			return nil, fmt.Errorf("mcp.lock:%d: duplicate id %q", i+1, row.ID)
		}
		rows[row.ID] = row
	}
	return rows, nil
}

func harnessRoot() (string, error) {
	if _, file, _, ok := runtime.Caller(0); ok {
		root := filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
		if _, err := os.Stat(filepath.Join(root, "mcp.lock")); err == nil {
			return root, nil
		}
	}
	// go test runs with the package directory as cwd.
	rel := filepath.Join("..", "..")
	if _, err := os.Stat(filepath.Join(rel, "mcp.lock")); err == nil {
		return filepath.Clean(rel), nil
	}
	return "", fmt.Errorf("mcp.lock not found (expected harness/mcp.lock)")
}

func loadMCPLock() (map[string]mcpLockRow, error) {
	root, err := harnessRoot()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(root, "mcp.lock"))
	if err != nil {
		return nil, err
	}
	return parseMCPLock(string(data))
}

// evalPluginRow is the sibling module for a tools_from server.
// A missing row names the server: flights-search-mcp is not in this repo.
func evalPluginRow(lock map[string]mcpLockRow, server string) (mcpLockRow, error) {
	row, ok := lock[server]
	if !ok {
		return mcpLockRow{}, fmt.Errorf("tools_from %q has no sibling module in mcp.lock", server)
	}
	return row, nil
}

func (r mcpLockRow) moduleDir(root string) (string, error) {
	p := strings.TrimPrefix(strings.TrimSpace(r.Path), "./")
	if p == "" || filepath.IsAbs(p) || strings.Contains(p, "..") {
		return "", fmt.Errorf("mcp.lock: plugin %q has unsafe path %q", r.ID, r.Path)
	}
	return filepath.Join(root, filepath.FromSlash(p)), nil
}

// pluginBuildPkg is the go build argument for the plugin's main package.
// A root main.go wins, matching harness/scripts/build-mcp.sh; otherwise
// the lock's binary name is the cmd directory.
func pluginBuildPkg(moduleDir, binary string) (string, error) {
	if _, err := os.Stat(filepath.Join(moduleDir, "main.go")); err == nil {
		return ".", nil
	}
	cmdDir := filepath.Join(moduleDir, "cmd", binary)
	if st, err := os.Stat(cmdDir); err == nil && st.IsDir() {
		return "./cmd/" + binary, nil
	}
	return "", fmt.Errorf("plugin %s: no main package under %s", binary, moduleDir)
}

// ensureEvalPlugin builds row into binDir/binary when that file is not
// already executable. CI prebuilds into EVAL_MCP_BIN; a local run leaves
// that unset and builds into a fresh temp directory. Reports whether it
// compiled (false means the binary was already there).
func ensureEvalPlugin(row mcpLockRow, binDir string) (bool, error) {
	out := filepath.Join(binDir, row.Binary)
	if st, err := os.Stat(out); err == nil && !st.IsDir() && st.Mode()&0o111 != 0 {
		return false, nil
	}
	if err := buildEvalPlugin(row, out); err != nil {
		return false, err
	}
	return true, nil
}

func buildEvalPlugin(row mcpLockRow, outPath string) error {
	root, err := harnessRoot()
	if err != nil {
		return err
	}
	dir, err := row.moduleDir(root)
	if err != nil {
		return err
	}
	st, err := os.Stat(dir)
	if err != nil || !st.IsDir() {
		return fmt.Errorf("tools_from %q: no sibling module at %s", row.ID, dir)
	}
	pkg, err := pluginBuildPkg(dir, row.Binary)
	if err != nil {
		return fmt.Errorf("tools_from %q: %w", row.ID, err)
	}
	if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
		return err
	}
	cmd := exec.Command("go", "build", "-o", outPath, pkg)
	cmd.Dir = dir
	cmd.Env = envWithout("CGO_ENABLED", "0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			return fmt.Errorf("tools_from %q: go build -o %s %s: %w", row.ID, outPath, pkg, err)
		}
		return fmt.Errorf("tools_from %q: go build -o %s %s: %w\n%s", row.ID, outPath, pkg, err, msg)
	}
	return nil
}

func envWithout(key, val string) []string {
	prefix := key + "="
	out := make([]string, 0, len(os.Environ())+1)
	for _, e := range os.Environ() {
		if strings.HasPrefix(e, prefix) {
			continue
		}
		out = append(out, e)
	}
	return append(out, prefix+val)
}

// evalBinDir is where plugin binaries are written. EVAL_MCP_BIN, when set,
// is reused (CI builds into it first). Otherwise a fresh temp directory,
// so a second local run does not keep a stale binary.
func evalBinDir() (string, error) {
	if dir := strings.TrimSpace(os.Getenv("EVAL_MCP_BIN")); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", err
		}
		return dir, nil
	}
	return os.MkdirTemp("", "gantry-eval-mcp-")
}

func TestParseMCPLock(t *testing.T) {
	rows, err := parseMCPLock("# comment\n\nrentals\t./mcp/rentals\tgithub.com/shotah/rentals-search-mcp\trentals-search-mcp\tRENTCAST_API_KEY\n")
	if err != nil {
		t.Fatal(err)
	}
	row, ok := rows["rentals"]
	if !ok || row.Binary != "rentals-search-mcp" || row.Path != "./mcp/rentals" || row.Module != "github.com/shotah/rentals-search-mcp" || row.Needs != "RENTCAST_API_KEY" {
		t.Fatalf("row=%+v ok=%v", row, ok)
	}
	if _, err := parseMCPLock("only-three\tfields\there\n"); err == nil {
		t.Fatal("short line should fail")
	}
	if _, err := evalPluginRow(rows, "flights"); err == nil || !strings.Contains(err.Error(), `"flights"`) || !strings.Contains(err.Error(), "mcp.lock") {
		t.Fatalf("missing sibling: %v", err)
	}
}

func TestEvalLockCoversSiblingPlugins(t *testing.T) {
	lock, err := loadMCPLock()
	if err != nil {
		t.Fatal(err)
	}
	root, err := harnessRoot()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := lock["flights"]; ok {
		t.Fatal("flights-search-mcp is not a sibling module")
	}
	want := map[string]string{
		"rentals": "./cmd/rentals-search-mcp",
		"google":  ".",
	}
	for id, pkg := range want {
		row, err := evalPluginRow(lock, id)
		if err != nil {
			t.Errorf("%s: %v", id, err)
			continue
		}
		dir, err := row.moduleDir(root)
		if err != nil {
			t.Errorf("%s: %v", id, err)
			continue
		}
		got, err := pluginBuildPkg(dir, row.Binary)
		if err != nil {
			t.Errorf("%s: %v", id, err)
			continue
		}
		if got != pkg {
			t.Errorf("%s build pkg %q want %q", id, got, pkg)
		}
	}
}

func TestPluginBuildPkg(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := pluginBuildPkg(root, "google-mcp")
	if err != nil || got != "." {
		t.Fatalf("root main: got %q err %v", got, err)
	}
	mod := t.TempDir()
	if err := os.MkdirAll(filepath.Join(mod, "cmd", "rentals-search-mcp"), 0o755); err != nil {
		t.Fatal(err)
	}
	got, err = pluginBuildPkg(mod, "rentals-search-mcp")
	if err != nil || got != "./cmd/rentals-search-mcp" {
		t.Fatalf("cmd: got %q err %v", got, err)
	}
	if _, err := pluginBuildPkg(t.TempDir(), "missing"); err == nil {
		t.Fatal("expected missing main package")
	}
}

func toolsFromServers(fixtures []evalFixture) []string {
	var names []string
	seen := map[string]bool{}
	for _, fx := range fixtures {
		for _, name := range fx.ToolsFrom {
			if name == "" || seen[name] {
				continue
			}
			seen[name] = true
			names = append(names, name)
		}
	}
	return names
}
