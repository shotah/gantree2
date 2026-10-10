package endpoint

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
)

type mcpNote struct {
	Name string `json:"name"`
}

func TestTypeToParamName(t *testing.T) {
	g := NewMCPGenerator(NewRegistry(), nil)
	cases := []struct {
		name string
		typ  reflect.Type
		want string
	}{
		{name: "nil", typ: nil, want: "body"},
		{name: "unnamed", typ: reflect.TypeOf(struct{ X int }{}), want: "body"},
		{name: "one word", typ: reflect.TypeFor[mcpNote](), want: "mcp_note"},
		{name: "multi word", typ: reflect.TypeOf(struct {
			A int
		}{}), want: "body"},
	}
	// Defined type with several capitals.
	type BloodPressureLogRequest struct{}
	cases = append(cases, struct {
		name string
		typ  reflect.Type
		want string
	}{name: "pascal", typ: reflect.TypeFor[BloodPressureLogRequest](), want: "blood_pressure_log_request"})

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := g.typeToParamName(tc.typ); got != tc.want {
				t.Fatalf("typeToParamName = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestMCPCallParsesArguments(t *testing.T) {
	day := time.Date(2026, 3, 4, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		name    string
		params  []Param
		body    *BodyConfig
		args    string
		handler func(t *testing.T, args *HandlerArgs) (any, error)
		wantErr string
		wantHas string
	}{
		{
			name:   "string and int",
			params: []Param{{Name: "activity_id", Type: ParamTypeString, Required: true}, {Name: "limit", Type: ParamTypeInt, Required: true}},
			args:   `{"activity_id":"abc","limit":3}`,
			handler: func(t *testing.T, args *HandlerArgs) (any, error) {
				t.Helper()
				if args.String("activity_id") != "abc" || args.Int("limit") != 3 {
					t.Fatalf("args = %#v", args.Params)
				}
				return map[string]string{"ok": "1"}, nil
			},
			wantHas: `"ok"`,
		},
		{
			name:    "missing required string",
			params:  []Param{{Name: "activity_id", Type: ParamTypeString, Required: true}},
			args:    `{}`,
			wantErr: "missing required parameter: activity_id",
		},
		{
			name:    "missing required int",
			params:  []Param{{Name: "limit", Type: ParamTypeInt, Required: true}},
			args:    `{}`,
			wantErr: "missing required parameter: limit",
		},
		{
			name:   "optional string and int omitted",
			params: []Param{{Name: "q", Type: ParamTypeString}, {Name: "limit", Type: ParamTypeInt}},
			args:   `{}`,
			handler: func(t *testing.T, args *HandlerArgs) (any, error) {
				t.Helper()
				if args.HasParam("q") || args.HasParam("limit") {
					t.Fatalf("optional params set: %#v", args.Params)
				}
				return map[string]bool{"empty": true}, nil
			},
		},
		{
			name:   "date",
			params: []Param{{Name: "date", Type: ParamTypeDate}},
			args:   `{"date":"2026-03-04"}`,
			handler: func(t *testing.T, args *HandlerArgs) (any, error) {
				t.Helper()
				if !args.Date("date").Equal(day) {
					t.Fatalf("date = %s", args.Date("date"))
				}
				return map[string]string{"date": "ok"}, nil
			},
		},
		{
			name:   "date defaults to today",
			params: []Param{{Name: "date", Type: ParamTypeDate}},
			args:   `{}`,
			handler: func(t *testing.T, args *HandlerArgs) (any, error) {
				t.Helper()
				if args.Date("date").IsZero() {
					t.Fatal("expected default date")
				}
				return map[string]string{"date": "today"}, nil
			},
		},
		{
			name:    "invalid date",
			params:  []Param{{Name: "date", Type: ParamTypeDate}},
			args:    `{"date":"March"}`,
			wantErr: "invalid date format",
		},
		{
			name:   "date range",
			params: []Param{{Name: "range", Type: ParamTypeDateRange}},
			args:   `{"start":"2026-03-01","end":"2026-03-04"}`,
			handler: func(t *testing.T, args *HandlerArgs) (any, error) {
				t.Helper()
				if args.Date("start").Format("2006-01-02") != "2026-03-01" || args.Date("end").Format("2006-01-02") != "2026-03-04" {
					t.Fatalf("range = %#v", args.Params)
				}
				return map[string]string{"range": "ok"}, nil
			},
		},
		{
			name:    "invalid start",
			params:  []Param{{Name: "range", Type: ParamTypeDateRange}},
			args:    `{"start":"nope"}`,
			wantErr: "invalid start date",
		},
		{
			name:    "invalid end",
			params:  []Param{{Name: "range", Type: ParamTypeDateRange}},
			args:    `{"end":"nope"}`,
			wantErr: "invalid end date",
		},
		{
			name:   "bool",
			params: []Param{{Name: "verbose", Type: ParamTypeBool}},
			args:   `{"verbose":true}`,
			handler: func(t *testing.T, args *HandlerArgs) (any, error) {
				t.Helper()
				if !args.Bool("verbose") {
					t.Fatal("verbose not set")
				}
				return map[string]bool{"verbose": true}, nil
			},
		},
		{
			name: "body",
			body: &BodyConfig{Type: reflect.TypeFor[mcpNote](), Description: "note", Example: `{"name":"x"}`},
			args: `{"mcp_note":"{\"name\":\"tide\"}"}`,
			handler: func(t *testing.T, args *HandlerArgs) (any, error) {
				t.Helper()
				note, ok := args.Body.(*mcpNote)
				if !ok || note.Name != "tide" {
					t.Fatalf("body = %#v", args.Body)
				}
				return note, nil
			},
			wantHas: "tide",
		},
		{
			name:    "body missing",
			body:    &BodyConfig{Type: reflect.TypeFor[mcpNote](), Description: "note"},
			args:    `{}`,
			wantErr: "missing required parameter: mcp_note",
		},
		{
			name:    "body invalid json",
			body:    &BodyConfig{Type: reflect.TypeFor[mcpNote](), Description: "note"},
			args:    `{"mcp_note":"{"}`,
			wantErr: "invalid JSON",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := NewRegistry()
			ep := Endpoint{
				Name:    "Probe",
				MCPTool: "probe_get",
				Long:    "probe",
				Params:  tc.params,
				Body:    tc.body,
				Handler: func(_ context.Context, _ any, args *HandlerArgs) (any, error) {
					if tc.handler == nil {
						t.Fatal("handler should not run")
					}
					return tc.handler(t, args)
				},
			}
			if tc.wantErr != "" && tc.handler == nil {
				ep.Handler = func(context.Context, any, *HandlerArgs) (any, error) {
					t.Fatal("handler should not run")
					return nil, nil
				}
			}
			r.Register(ep)
			s := mcpserver.NewMCPServer("garmin", "test", mcpserver.WithToolCapabilities(true))
			if _, err := NewMCPGenerator(r, "client").RegisterTools(s, ToolFilter{}); err != nil {
				t.Fatal(err)
			}
			text, isErr := callProbe(t, s, tc.args)
			if tc.wantErr != "" {
				if !isErr || !strings.Contains(text, tc.wantErr) {
					t.Fatalf("text=%q isErr=%v, want error %q", text, isErr, tc.wantErr)
				}
				return
			}
			if isErr {
				t.Fatalf("unexpected tool error: %s", text)
			}
			if tc.wantHas != "" && !strings.Contains(text, tc.wantHas) {
				t.Fatalf("result %q missing %q", text, tc.wantHas)
			}
		})
	}
}

func TestMCPCallHandlerAndResultErrors(t *testing.T) {
	t.Run("handler error", func(t *testing.T) {
		r := NewRegistry()
		r.Register(Endpoint{
			MCPTool: "probe_get",
			Long:    "probe",
			Handler: func(context.Context, any, *HandlerArgs) (any, error) {
				return nil, errNoJSONBody
			},
		})
		s := mcpserver.NewMCPServer("garmin", "test", mcpserver.WithToolCapabilities(true))
		if _, err := NewMCPGenerator(r, nil).RegisterTools(s, ToolFilter{}); err != nil {
			t.Fatal(err)
		}
		text, isErr := callProbe(t, s, `{}`)
		if !isErr || !strings.Contains(text, "no JSON body") {
			t.Fatalf("text=%q isErr=%v", text, isErr)
		}
	})

	t.Run("unmarshalable result", func(t *testing.T) {
		r := NewRegistry()
		r.Register(Endpoint{
			MCPTool: "probe_get",
			Long:    "probe",
			Handler: func(context.Context, any, *HandlerArgs) (any, error) {
				return make(chan int), nil
			},
		})
		s := mcpserver.NewMCPServer("garmin", "test", mcpserver.WithToolCapabilities(true))
		if _, err := NewMCPGenerator(r, nil).RegisterTools(s, ToolFilter{}); err != nil {
			t.Fatal(err)
		}
		text, isErr := callProbe(t, s, `{}`)
		if !isErr || text == "" {
			t.Fatalf("text=%q isErr=%v", text, isErr)
		}
	})
}

func callProbe(t *testing.T, s *mcpserver.MCPServer, args string) (string, bool) {
	t.Helper()
	raw := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"probe_get","arguments":` + args + `}}`
	resp := s.HandleMessage(context.Background(), []byte(raw))
	msg, ok := resp.(mcp.JSONRPCResponse)
	if !ok {
		t.Fatalf("response %T %#v", resp, resp)
	}
	result, ok := msg.Result.(mcp.CallToolResult)
	if !ok {
		if p, pok := msg.Result.(*mcp.CallToolResult); pok {
			result = *p
		} else {
			t.Fatalf("result %T", msg.Result)
		}
	}
	var b strings.Builder
	for _, c := range result.Content {
		if text, tok := c.(mcp.TextContent); tok {
			b.WriteString(text.Text)
		}
	}
	return b.String(), result.IsError
}
