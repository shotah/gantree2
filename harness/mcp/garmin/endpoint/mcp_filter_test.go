package endpoint

import (
	"context"
	"testing"

	"github.com/mark3labs/mcp-go/server"
)

func TestParseToolFilter(t *testing.T) {
	f, err := ParseToolFilter("Sleep, wellness  HRV", "CORE")
	if err != nil {
		t.Fatal(err)
	}
	if f.Tier != TierCore {
		t.Fatalf("tier=%s", f.Tier)
	}
	for _, name := range []string{"sleep", "wellness", "hrv"} {
		if _, ok := f.Services[name]; !ok {
			t.Fatalf("missing service %q", name)
		}
	}

	if _, err := ParseToolFilter("", "nope"); err == nil {
		t.Fatal("expected invalid tier error")
	}

	f2, err := ParseToolFilter("", "")
	if err != nil {
		t.Fatal(err)
	}
	if f2.Tier != TierComplete || len(f2.Services) != 0 {
		t.Fatalf("default filter = %+v", f2)
	}
}

func TestToolFilter_Allows(t *testing.T) {
	core, _ := ParseToolFilter("", "core")
	if !core.Allows(&Endpoint{Service: "Sleep", MCPTool: "sleep_get"}) {
		t.Fatal("core should allow sleep_get")
	}
	if core.Allows(&Endpoint{Service: "Golf", MCPTool: "golf_list_scorecards"}) {
		t.Fatal("core should not allow golf")
	}
	if core.Allows(&Endpoint{Service: "Sleep", MCPTool: "sleep_get", RawOutput: true}) {
		t.Fatal("raw output skipped")
	}

	svc, _ := ParseToolFilter("sleep", "complete")
	if !svc.Allows(&Endpoint{Service: "Sleep", MCPTool: "sleep_get"}) {
		t.Fatal("service filter should allow sleep")
	}
	if svc.Allows(&Endpoint{Service: "Weight", MCPTool: "weight_get"}) {
		t.Fatal("service filter should deny weight")
	}

	// Intersection: service match but not in core → denied
	sleepCore, _ := ParseToolFilter("wellness", "core")
	if sleepCore.Allows(&Endpoint{Service: "Wellness", MCPTool: "wellness_get_stress"}) {
		t.Fatal("wellness_get_stress is extended, not core")
	}
	if !sleepCore.Allows(&Endpoint{Service: "Wellness", MCPTool: "wellness_get_body_battery"}) {
		t.Fatal("wellness_get_body_battery is core")
	}

	ext, _ := ParseToolFilter("", "extended")
	if !ext.Allows(&Endpoint{Service: "Wellness", MCPTool: "wellness_get_stress"}) {
		t.Fatal("extended should allow wellness_get_stress")
	}
}

func TestRegisterTools_Filter(t *testing.T) {
	r := NewRegistry()
	noop := func(_ context.Context, _ any, _ *HandlerArgs) (any, error) {
		return map[string]string{"ok": "1"}, nil
	}
	r.Register(Endpoint{Name: "GetSleep", Service: "Sleep", MCPTool: "sleep_get", Handler: noop})
	r.Register(Endpoint{Name: "GetStress", Service: "Wellness", MCPTool: "wellness_get_stress", Handler: noop})
	r.Register(Endpoint{Name: "GetBB", Service: "Wellness", MCPTool: "wellness_get_body_battery", Handler: noop})
	r.Register(Endpoint{Name: "Golf", Service: "Golf", MCPTool: "golf_list_scorecards", Handler: noop})

	s := server.NewMCPServer("test", "1.0.0", server.WithToolCapabilities(true))
	gen := NewMCPGenerator(r, nil)
	filter, err := ParseToolFilter("", "core")
	if err != nil {
		t.Fatal(err)
	}
	n, err := gen.RegisterTools(s, filter)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("core count=%d want 2 (sleep_get, wellness_get_body_battery)", n)
	}
	tools := s.ListTools()
	if _, ok := tools["sleep_get"]; !ok {
		t.Fatal("missing sleep_get")
	}
	if _, ok := tools["wellness_get_body_battery"]; !ok {
		t.Fatal("missing wellness_get_body_battery")
	}
	if _, ok := tools["wellness_get_stress"]; ok {
		t.Fatal("wellness_get_stress should not be in core")
	}
}

func TestRegisterTools_UnknownService(t *testing.T) {
	r := NewRegistry()
	r.Register(Endpoint{
		Name: "GetSleep", Service: "Sleep", MCPTool: "sleep_get",
		Handler: func(_ context.Context, _ any, _ *HandlerArgs) (any, error) {
			return map[string]string{}, nil
		},
	})
	s := server.NewMCPServer("test", "1.0.0", server.WithToolCapabilities(true))
	gen := NewMCPGenerator(r, nil)
	filter, _ := ParseToolFilter("notaservice", "complete")
	if _, err := gen.RegisterTools(s, filter); err == nil {
		t.Fatal("expected unknown service error")
	}
}
