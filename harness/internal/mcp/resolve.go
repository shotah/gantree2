package mcp

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// mcpOptRoot is the image directory of baked plugins: <root>/<id>/<id>.
// Tests point it at a temp directory. A native install leaves the default
// empty and resolves a bare command through PATH.
var mcpOptRoot = "/opt/mcp"

// resolveExecutable returns the program to exec for command.
//
// A command that already contains a path separator is used as given
// (LookPath only checks that it exists). A bare server command — the
// mcp.toml value, often the historical module name such as feeds-mcp —
// uses /opt/mcp/<name>/<name> when that file is executable. That is the
// only copy the image ships. When the file is absent, LookPath(command)
// is the native and test fallback.
func resolveExecutable(spec ServerSpec, command string) (string, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return "", fmt.Errorf("exec: %q: executable file not found in $PATH", command)
	}
	if !strings.ContainsAny(command, `/\`) && command == strings.TrimSpace(spec.Command) {
		if baked := bakedPluginPath(spec.Name); baked != "" && executableFile(baked) {
			return baked, nil
		}
	}
	path, err := exec.LookPath(command)
	if err != nil {
		return "", err
	}
	return path, nil
}

func bakedPluginPath(name string) string {
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." || strings.Contains(name, "..") || strings.ContainsAny(name, `/\`) {
		return ""
	}
	return filepath.Join(mcpOptRoot, name, name)
}

func executableFile(path string) bool {
	st, err := os.Stat(path)
	if err != nil || st.IsDir() {
		return false
	}
	return st.Mode()&0o111 != 0
}
