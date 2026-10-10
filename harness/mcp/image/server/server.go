package server

import (
	mcpserver "github.com/mark3labs/mcp-go/server"
)

// ServerName is the host mcp.toml id. Tools are exposed as image__photo_generate.
const ServerName = "image"

// ServerVersion is overwritten at link time by GoReleaser / `make cli`
// (-X github.com/shotah/image-generation-mcp/server.ServerVersion=...).
var ServerVersion = "0.1.0"

// New creates a stdio MCP server with tool capabilities.
func New() *mcpserver.MCPServer {
	return mcpserver.NewMCPServer(
		ServerName,
		ServerVersion,
		mcpserver.WithToolCapabilities(true),
	)
}
