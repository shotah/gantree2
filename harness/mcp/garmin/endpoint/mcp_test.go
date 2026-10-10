// endpoint/mcp_test.go
package endpoint

import (
	"context"
	"testing"

	"github.com/mark3labs/mcp-go/server"
)

func TestMCPGenerator_RegisterTools(t *testing.T) {
	r := NewRegistry()
	r.Register(Endpoint{
		Name:    "GetSleep",
		MCPTool: "sleep_get",
		Long:    "Get sleep data",
		Params: []Param{
			{Name: "date", Type: ParamTypeDate, Description: "The date"},
		},
		Handler: func(_ context.Context, _ any, _ *HandlerArgs) (any, error) {
			return map[string]string{"status": "ok"}, nil
		},
	})

	s := server.NewMCPServer("test", "1.0.0", server.WithToolCapabilities(true))
	gen := NewMCPGenerator(r, nil)
	if _, err := gen.RegisterTools(s, ToolFilter{}); err != nil {
		t.Fatal(err)
	}

	// Verify tool was registered by listing tools
	tools := s.ListTools()
	if len(tools) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(tools))
	}
	if _, ok := tools["sleep_get"]; !ok {
		t.Error("expected 'sleep_get' tool to be registered")
	}
}

func TestMCPGenerator_SkipsRawOutputEndpoints(t *testing.T) {
	r := NewRegistry()
	r.Register(Endpoint{
		Name:      "DownloadGPX",
		MCPTool:   "download_gpx",
		Long:      "Download GPX file",
		RawOutput: true,
		Handler: func(_ context.Context, _ any, _ *HandlerArgs) (any, error) {
			return []byte("binary data"), nil
		},
	})

	s := server.NewMCPServer("test", "1.0.0", server.WithToolCapabilities(true))
	gen := NewMCPGenerator(r, nil)
	if _, err := gen.RegisterTools(s, ToolFilter{}); err != nil {
		t.Fatal(err)
	}

	tools := s.ListTools()
	if len(tools) != 0 {
		t.Fatalf("expected 0 tools (RawOutput should be skipped), got %d", len(tools))
	}
}

func TestMCPGenerator_SkipsEndpointsWithoutMCPTool(t *testing.T) {
	r := NewRegistry()
	r.Register(Endpoint{
		Name:       "GetSleep",
		CLICommand: "sleep",
		// MCPTool not set
		Handler: func(_ context.Context, _ any, _ *HandlerArgs) (any, error) {
			return struct{}{}, nil
		},
	})

	s := server.NewMCPServer("test", "1.0.0", server.WithToolCapabilities(true))
	gen := NewMCPGenerator(r, nil)
	if _, err := gen.RegisterTools(s, ToolFilter{}); err != nil {
		t.Fatal(err)
	}

	tools := s.ListTools()
	if len(tools) != 0 {
		t.Fatalf("expected 0 tools, got %d", len(tools))
	}
}

func TestMCPGenerator_MultipleParams(t *testing.T) {
	r := NewRegistry()
	r.Register(Endpoint{
		Name:    "ListActivities",
		MCPTool: "activities_list",
		Long:    "List activities",
		Params: []Param{
			{Name: "start", Type: ParamTypeInt, Description: "Starting index"},
			{Name: "limit", Type: ParamTypeInt, Description: "Max results"},
		},
		Handler: func(_ context.Context, _ any, _ *HandlerArgs) (any, error) {
			return []string{}, nil
		},
	})

	s := server.NewMCPServer("test", "1.0.0", server.WithToolCapabilities(true))
	gen := NewMCPGenerator(r, nil)
	if _, err := gen.RegisterTools(s, ToolFilter{}); err != nil {
		t.Fatal(err)
	}

	tools := s.ListTools()
	if len(tools) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(tools))
	}
}

func TestMCPGenerator_DateRangeParams(t *testing.T) {
	r := NewRegistry()
	r.Register(Endpoint{
		Name:    "GetWeight",
		MCPTool: "weight_get",
		Long:    "Get weight data",
		Params: []Param{
			{Name: "range", Type: ParamTypeDateRange, Description: "Date range"},
		},
		Handler: func(_ context.Context, _ any, _ *HandlerArgs) (any, error) {
			return struct{}{}, nil
		},
	})

	s := server.NewMCPServer("test", "1.0.0", server.WithToolCapabilities(true))
	gen := NewMCPGenerator(r, nil)
	if _, err := gen.RegisterTools(s, ToolFilter{}); err != nil {
		t.Fatal(err)
	}

	tools := s.ListTools()
	if len(tools) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(tools))
	}
}

func TestMCPGenerator_BoolParam(t *testing.T) {
	r := NewRegistry()
	r.Register(Endpoint{
		Name:    "GetData",
		MCPTool: "get_data",
		Long:    "Get data",
		Params: []Param{
			{Name: "verbose", Type: ParamTypeBool, Description: "Verbose output"},
		},
		Handler: func(_ context.Context, _ any, _ *HandlerArgs) (any, error) {
			return struct{}{}, nil
		},
	})

	s := server.NewMCPServer("test", "1.0.0", server.WithToolCapabilities(true))
	gen := NewMCPGenerator(r, nil)
	if _, err := gen.RegisterTools(s, ToolFilter{}); err != nil {
		t.Fatal(err)
	}

	tools := s.ListTools()
	if len(tools) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(tools))
	}
}

func TestMCPGenerator_RequiredParam(t *testing.T) {
	r := NewRegistry()
	r.Register(Endpoint{
		Name:    "GetActivity",
		MCPTool: "activities_get",
		Long:    "Get activity",
		Params: []Param{
			{Name: "activity_id", Type: ParamTypeString, Required: true, Description: "The activity ID"},
		},
		Handler: func(_ context.Context, _ any, _ *HandlerArgs) (any, error) {
			return struct{}{}, nil
		},
	})

	s := server.NewMCPServer("test", "1.0.0", server.WithToolCapabilities(true))
	gen := NewMCPGenerator(r, nil)
	if _, err := gen.RegisterTools(s, ToolFilter{}); err != nil {
		t.Fatal(err)
	}

	tools := s.ListTools()
	if len(tools) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(tools))
	}
}
