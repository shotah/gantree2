package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	mcpserver "github.com/shotah/rentals-search-mcp/internal/mcp"
)

// version is set at build time via ldflags.
var version = "dev"

// runServer starts the MCP stdio loop; overridden in tests.
var runServer = func(ctx context.Context, s *mcpserver.Server) error {
	return s.Run(ctx)
}

func main() {
	if version != "" && version != "dev" {
		mcpserver.ServerVersion = version
	}
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	fs := flag.NewFlagSet("rentals-search-mcp", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	showVersion := fs.Bool("version", false, "print version and exit")
	selfTest := fs.Bool("self-test", false, "run smoke checks and exit")
	if err := fs.Parse(args); err != nil {
		return 2
	}

	if *showVersion {
		if version != "" && version != "dev" {
			fmt.Println(version)
		} else {
			fmt.Println(mcpserver.ServerVersion)
		}
		return 0
	}

	if *selfTest {
		if err := mcpserver.SelfTest(); err != nil {
			fmt.Fprintf(os.Stderr, "self-test failed: %v\n", err)
			return 1
		}
		fmt.Fprintln(os.Stderr, "self-test ok")
		return 0
	}

	srv := mcpserver.New(nil)
	if err := runServer(context.Background(), srv); err != nil {
		fmt.Fprintf(os.Stderr, "mcp server error: %v\n", err)
		return 1
	}
	return 0
}
