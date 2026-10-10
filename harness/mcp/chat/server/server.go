package server

import (
	mcpserver "github.com/mark3labs/mcp-go/server"
)

// ServerName is the host mcp.toml id. Tools are exposed as chat__avatar_update.
const ServerName = "chat"

// ServerVersion is overwritten at link time by GoReleaser / `make cli`
// (-X github.com/shotah/pendant-mcp/server.ServerVersion=...).
var ServerVersion = "0.1.0"

// New creates a stdio MCP server with tool capabilities.
func New() *mcpserver.MCPServer {
	return mcpserver.NewMCPServer(
		ServerName,
		ServerVersion,
		mcpserver.WithToolCapabilities(true),
	)
}
