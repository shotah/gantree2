package main

import (
	"bytes"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/shotah/go-garmin/endpoint"
)

func TestPrintSummaryCountsTiers(t *testing.T) {
	registry := endpoint.NewRegistry()
	registry.Register(endpoint.Endpoint{Name: "Both", CLICommand: "both", MCPTool: "both_get"})
	registry.Register(endpoint.Endpoint{Name: "CLI", CLICommand: "cli"})
	registry.Register(endpoint.Endpoint{Name: "MCP", MCPTool: "mcp_get"})
	registry.Register(endpoint.Endpoint{Name: "Neither"})

	var buf bytes.Buffer
	old := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = w
	printSummary(registry)
	_ = w.Close()
	os.Stdout = old
	if _, err := io.Copy(&buf, r); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	for _, needle := range []string{
		"All 4 endpoints validated successfully",
		"Total endpoints:    4",
		"With CLI command:   2",
		"With MCP tool:      2",
		"With both:          1",
	} {
		if !strings.Contains(out, needle) {
			t.Errorf("summary missing %q in %s", needle, out)
		}
	}
}
