package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/shotah/google-health-mcp/internal/ghealth"
	mcpserver "github.com/shotah/google-health-mcp/internal/mcp"
)

// version is set at build time via ldflags.
var version = "dev"

var runServer = func(ctx context.Context, s *mcpserver.Server) error {
	return s.Run(ctx)
}

// runAuth is overridable in tests.
var runAuth = ghealth.RunAuth

// runAuthURL is overridable in tests.
var runAuthURL = ghealth.RunAuthURL

// runAuthExchange is overridable in tests.
var runAuthExchange = ghealth.RunAuthExchange

func main() {
	if version != "" && version != "dev" {
		mcpserver.ServerVersion = version
	}
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	if len(args) > 0 && args[0] == "auth" {
		return runAuthCmd(args[1:])
	}

	fs := flag.NewFlagSet("google-health-mcp", flag.ContinueOnError)
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

func runAuthCmd(args []string) int {
	c := ghealth.MaybeFromEnv()
	ctx := context.Background()

	if len(args) > 0 {
		switch args[0] {
		case "url":
			if err := runAuthURL(ctx, c); err != nil {
				fmt.Fprintf(os.Stderr, "google-health-mcp auth url: %v\n", err)
				return 1
			}
			return 0
		case "exchange":
			if len(args) < 2 {
				fmt.Fprintln(os.Stderr, "usage: google-health-mcp auth exchange <code>")
				return 2
			}
			if err := runAuthExchange(ctx, c, args[1]); err != nil {
				fmt.Fprintf(os.Stderr, "google-health-mcp auth exchange: %v\n", err)
				return 1
			}
			return 0
		}
	}

	// Default: interactive localhost auth
	if err := runAuth(ctx, c); err != nil {
		fmt.Fprintf(os.Stderr, "google-health-mcp auth: %v\n", err)
		return 1
	}
	return 0
}
