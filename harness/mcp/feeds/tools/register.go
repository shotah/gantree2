// Package tools registers items_list and source_resolve.
package tools

import (
	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
)

// Tool names — service_verb_object, no server-id prefix.
// Host mcp.toml name is feeds → feeds__items_list, feeds__source_resolve.
// See https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md
const (
	ToolList    = "items_list"
	ToolResolve = "source_resolve"
)

// ToolNames is the registered catalog (tests lock naming).
func ToolNames() []string {
	return []string{ToolList, ToolResolve}
}

// Register attaches both tools to s.
func Register(s *mcpserver.MCPServer) {
	registerFetch(s)
	registerResolve(s)
}

func registerTool(s *mcpserver.MCPServer, tool mcp.Tool, handler mcpserver.ToolHandlerFunc) {
	s.AddTool(tool, handler)
}
