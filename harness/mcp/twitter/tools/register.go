// Package tools registers posts_list.
package tools

import (
	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
)

// Tool names — service_verb_object, no server-id prefix.
// Host mcp.toml name is twitter → twitter__posts_list.
// See https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md
const ToolList = "posts_list"

// ToolNames is the registered catalog (tests lock naming).
func ToolNames() []string {
	return []string{ToolList}
}

// Register attaches posts_list to s.
func Register(s *mcpserver.MCPServer) {
	registerPosts(s)
}

func registerTool(s *mcpserver.MCPServer, tool mcp.Tool, handler mcpserver.ToolHandlerFunc) {
	s.AddTool(tool, handler)
}
