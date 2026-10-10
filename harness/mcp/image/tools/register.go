package tools

import (
	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
)

// Tool names — service_verb_object, no server-id prefix.
// Host mcp.toml name is image → image__photo_generate, image__photo_edit.
// Do not name tools image_* (host would expose image__image_generate).
// See https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md
const (
	ToolGenerate = "photo_generate"
	ToolEdit     = "photo_edit"
)

const (
	nextGenerate = `Next: photo_generate(prompt="a red bicycle leaning on a brick wall")`
	nextEdit     = `Next: photo_edit(prompt="add a hat", source_path="<IMAGE_OUTPUT_DIR/file.jpg>")`
)

// ToolNames is the registered catalog (tests lock naming).
func ToolNames() []string {
	return []string{ToolGenerate, ToolEdit}
}

// Register attaches all tools to s.
func Register(s *mcpserver.MCPServer) {
	registerGenerate(s)
	registerEdit(s)
}

func registerTool(s *mcpserver.MCPServer, tool mcp.Tool, handler mcpserver.ToolHandlerFunc) {
	s.AddTool(tool, handler)
}
