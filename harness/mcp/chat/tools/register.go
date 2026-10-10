package tools

import (
	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
)

// Tool names — service_verb_object, no server-id prefix.
// Host mcp.toml name is pendant → pendant__avatar_update, …
// Do not name tools pendant_* (host would expose pendant__pendant_avatar_update).
// See https://github.com/shotah/ai-gantry/blob/main/docs/mcp-naming.md
const (
	ToolAvatarUpdate   = "avatar_update"
	ToolAvatarGet      = "avatar_get"
	ToolBackdropUpdate = "backdrop_update"
	ToolBackdropDelete = "backdrop_delete"
	ToolThemeList      = "theme_list"
	ToolThemeUpdate    = "theme_update"
	ToolThemeDelete    = "theme_delete"
)

const (
	nextAvatarUpdate   = `Next: avatar_update(source_path="<IMAGE_OUTPUT_DIR/file.png>")`
	nextAvatarGet      = `Next: avatar_get()`
	nextBackdropUpdate = `Next: backdrop_update(source_path="<IMAGE_OUTPUT_DIR/file.png>")`
	nextBackdropDelete = `Next: backdrop_delete()`
	nextThemeList      = `Next: theme_list()`
	nextThemeDelete    = `Next: theme_delete()`
)

// ToolNames is the registered catalog (tests lock naming).
func ToolNames() []string {
	return []string{
		ToolAvatarUpdate,
		ToolAvatarGet,
		ToolBackdropUpdate,
		ToolBackdropDelete,
		ToolThemeList,
		ToolThemeUpdate,
		ToolThemeDelete,
	}
}

// Register attaches all tools to s.
func Register(s *mcpserver.MCPServer) {
	registerAvatar(s)
	registerBackdrop(s)
	registerTheme(s)
}

func registerTool(s *mcpserver.MCPServer, tool mcp.Tool, handler mcpserver.ToolHandlerFunc) {
	s.AddTool(tool, handler)
}
