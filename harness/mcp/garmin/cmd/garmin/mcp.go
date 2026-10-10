package main

import (
	"fmt"
	"os"

	"github.com/mark3labs/mcp-go/server"
	"github.com/shotah/go-garmin/endpoint"
	"github.com/spf13/cobra"
)

var (
	mcpToolsFlag string
	mcpTierFlag  string
)

var mcpCmd = &cobra.Command{
	Use:   "mcp",
	Short: "Start MCP server for LLM integration",
	Long: `Start a Model Context Protocol server that exposes Garmin data to LLM assistants.

By default every eligible endpoint is published (~100 tools). Narrow the surface
with --tools (services) and/or --tool-tier (core|extended|complete):

  garmin mcp --tool-tier core
  garmin mcp --tools "sleep wellness hrv weight activities metrics utility" --tool-tier core

Service names match Endpoint.Service (case-insensitive), e.g. sleep, wellness,
activities, metrics. See README "MCP server" for the tier tool lists.`,
	RunE: runMCP,
}

func init() {
	mcpCmd.Flags().StringVar(&mcpToolsFlag, "tools", "",
		"space/comma-separated services to publish (default: all)")
	mcpCmd.Flags().StringVar(&mcpTierFlag, "tool-tier", "complete",
		"tool depth within selected services: core|extended|complete")
}

func runMCP(_ *cobra.Command, _ []string) error {
	client, err := loadClient()
	if err != nil {
		return err
	}

	filter, err := endpoint.ParseToolFilter(mcpToolsFlag, mcpTierFlag)
	if err != nil {
		return err
	}

	s := server.NewMCPServer(
		"garmin",
		"1.0.0",
		server.WithToolCapabilities(true),
	)

	mcpGen := endpoint.NewMCPGenerator(endpointRegistry, client)
	n, err := mcpGen.RegisterTools(s, filter)
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "garmin mcp: published %d tools (tier=%s)\n", n, filter.Tier)

	return server.ServeStdio(s)
}
