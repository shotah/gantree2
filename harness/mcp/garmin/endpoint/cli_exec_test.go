package endpoint

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

type cliNote struct {
	Name string `json:"name"`
}

func TestCLIExecuteParsesArgs(t *testing.T) {
	day := time.Date(2026, 4, 2, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		name    string
		params  []Param
		args    []string
		wantErr string
		check   func(t *testing.T, args *HandlerArgs)
	}{
		{
			name:   "required string and int",
			params: []Param{{Name: "id", Type: ParamTypeString, Required: true}, {Name: "n", Type: ParamTypeInt, Required: true}},
			args:   []string{"abc", "12"},
			check: func(t *testing.T, args *HandlerArgs) {
				t.Helper()
				if args.String("id") != "abc" || args.Int("n") != 12 {
					t.Fatalf("args %#v", args.Params)
				}
			},
		},
		{
			name:    "missing string",
			params:  []Param{{Name: "id", Type: ParamTypeString, Required: true}},
			wantErr: "missing required argument: id",
		},
		{
			name:    "missing int",
			params:  []Param{{Name: "n", Type: ParamTypeInt, Required: true}},
			wantErr: "missing required argument: n",
		},
		{
			name:    "bad int",
			params:  []Param{{Name: "n", Type: ParamTypeInt, Required: true}},
			args:    []string{"nope"},
			wantErr: "invalid integer",
		},
		{
			name:   "date",
			params: []Param{{Name: "date", Type: ParamTypeDate}},
			args:   []string{"2026-04-02"},
			check: func(t *testing.T, args *HandlerArgs) {
				t.Helper()
				if !args.Date("date").Equal(day) {
					t.Fatalf("date %s", args.Date("date"))
				}
			},
		},
		{
			name:   "date defaults",
			params: []Param{{Name: "date", Type: ParamTypeDate}},
			check: func(t *testing.T, args *HandlerArgs) {
				t.Helper()
				if args.Date("date").Format("2006-01-02") != time.Now().Format("2006-01-02") {
					t.Fatalf("date %s", args.Date("date"))
				}
			},
		},
		{
			name:    "bad date",
			params:  []Param{{Name: "date", Type: ParamTypeDate}},
			args:    []string{"yesterday"},
			wantErr: "invalid date",
		},
		{
			name:   "date range",
			params: []Param{{Name: "range", Type: ParamTypeDateRange}},
			args:   []string{"--start", "2026-04-01", "--end", "2026-04-02"},
			check: func(t *testing.T, args *HandlerArgs) {
				t.Helper()
				if args.Date("start").Format("2006-01-02") != "2026-04-01" || args.Date("end").Format("2006-01-02") != "2026-04-02" {
					t.Fatalf("range %#v", args.Params)
				}
			},
		},
		{
			name:    "bad start",
			params:  []Param{{Name: "range", Type: ParamTypeDateRange}},
			args:    []string{"--start", "nope"},
			wantErr: "invalid start date",
		},
		{
			name:    "bad end",
			params:  []Param{{Name: "range", Type: ParamTypeDateRange}},
			args:    []string{"--end", "nope"},
			wantErr: "invalid end date",
		},
		{
			name:   "optional flags",
			params: []Param{{Name: "q", Type: ParamTypeString}, {Name: "limit", Type: ParamTypeInt}, {Name: "verbose", Type: ParamTypeBool}},
			args:   []string{"--q", "run", "--limit", "4", "--verbose"},
			check: func(t *testing.T, args *HandlerArgs) {
				t.Helper()
				if args.String("q") != "run" || args.Int("limit") != 4 || !args.Bool("verbose") {
					t.Fatalf("args %#v", args.Params)
				}
			},
		},
		{
			name:   "zero optional int omitted",
			params: []Param{{Name: "limit", Type: ParamTypeInt}, {Name: "verbose", Type: ParamTypeBool}},
			check: func(t *testing.T, args *HandlerArgs) {
				t.Helper()
				if args.HasParam("limit") || args.HasParam("verbose") {
					t.Fatalf("zero flags stored: %#v", args.Params)
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got *HandlerArgs
			text, err := runCLI(t, Endpoint{
				Name:       "Probe",
				CLICommand: "probe",
				Short:      "probe",
				Params:     tc.params,
				Handler: func(_ context.Context, _ any, args *HandlerArgs) (any, error) {
					got = args
					return map[string]string{"status": "ok"}, nil
				},
			}, tc.args)
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("err=%v, want %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(text, "ok") {
				t.Fatalf("output %q", text)
			}
			if tc.check != nil {
				tc.check(t, got)
			}
		})
	}
}

func TestCLIExecuteBodyAndRaw(t *testing.T) {
	restore := swapStdin(t, devNull(t))
	defer restore()

	t.Run("json flag", func(t *testing.T) {
		text, err := runCLI(t, noteEndpoint(t), []string{"--json", `{"name":"tide"}`})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(text, "tide") {
			t.Fatalf("output %q", text)
		}
	})

	t.Run("file flag", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "note.json")
		if err := os.WriteFile(path, []byte(`{"name":"file"}`), 0o600); err != nil {
			t.Fatal(err)
		}
		text, err := runCLI(t, noteEndpoint(t), []string{"--file", path})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(text, "file") {
			t.Fatalf("output %q", text)
		}
	})

	t.Run("missing file", func(t *testing.T) {
		_, err := runCLI(t, noteEndpoint(t), []string{"--file", filepath.Join(t.TempDir(), "missing.json")})
		if err == nil || !strings.Contains(err.Error(), "failed to read file") {
			t.Fatalf("err=%v", err)
		}
	})

	t.Run("invalid json", func(t *testing.T) {
		_, err := runCLI(t, noteEndpoint(t), []string{"--json", `{`})
		if err == nil || !strings.Contains(err.Error(), "invalid JSON") {
			t.Fatalf("err=%v", err)
		}
	})

	t.Run("no body", func(t *testing.T) {
		_, err := runCLI(t, noteEndpoint(t), nil)
		if err == nil || !strings.Contains(err.Error(), "no JSON body") {
			t.Fatalf("err=%v", err)
		}
	})

	t.Run("stdin", func(t *testing.T) {
		r, w, err := os.Pipe()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.WriteString(`{"name":"stdin"}`); err != nil {
			t.Fatal(err)
		}
		_ = w.Close()
		undo := swapStdin(t, r)
		defer undo()
		text, err := runCLI(t, noteEndpoint(t), nil)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(text, "stdin") {
			t.Fatalf("output %q", text)
		}
	})

	t.Run("raw stdout", func(t *testing.T) {
		text, err := runCLI(t, Endpoint{
			CLICommand: "raw",
			RawOutput:  true,
			Handler: func(context.Context, any, *HandlerArgs) (any, error) {
				return []byte("raw-bytes"), nil
			},
		}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if text != "raw-bytes" {
			t.Fatalf("output %q", text)
		}
	})

	t.Run("raw file", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "out.bin")
		_, err := runCLI(t, Endpoint{
			CLICommand: "raw",
			RawOutput:  true,
			Handler: func(context.Context, any, *HandlerArgs) (any, error) {
				return []byte("saved"), nil
			},
		}, []string{"--output", path})
		if err != nil {
			t.Fatal(err)
		}
		got, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != "saved" {
			t.Fatalf("file %q", got)
		}
	})

	t.Run("raw wrong type", func(t *testing.T) {
		_, err := runCLI(t, Endpoint{
			CLICommand: "raw",
			RawOutput:  true,
			Handler: func(context.Context, any, *HandlerArgs) (any, error) {
				return "nope", nil
			},
		}, nil)
		if err == nil || !strings.Contains(err.Error(), "raw output") {
			t.Fatalf("err=%v", err)
		}
	})

	t.Run("handler error", func(t *testing.T) {
		_, err := runCLI(t, Endpoint{
			CLICommand: "probe",
			Handler: func(context.Context, any, *HandlerArgs) (any, error) {
				return nil, errNoJSONBody
			},
		}, nil)
		if err == nil {
			t.Fatal("expected error")
		}
	})

	t.Run("json encode error", func(t *testing.T) {
		_, err := runCLI(t, Endpoint{
			CLICommand: "probe",
			Handler: func(context.Context, any, *HandlerArgs) (any, error) {
				return make(chan int), nil
			},
		}, nil)
		if err == nil {
			t.Fatal("expected encode error")
		}
	})
}

func noteEndpoint(t *testing.T) Endpoint {
	t.Helper()
	return Endpoint{
		CLICommand: "note",
		Body:       &BodyConfig{Type: reflect.TypeFor[cliNote]()},
		Handler: func(_ context.Context, _ any, args *HandlerArgs) (any, error) {
			note, ok := args.Body.(*cliNote)
			if !ok {
				t.Fatalf("body %T", args.Body)
			}
			return note, nil
		},
	}
}

func runCLI(t *testing.T, ep Endpoint, args []string) (string, error) {
	t.Helper()
	r := NewRegistry()
	r.Register(ep)
	gen := NewCLIGenerator(r)
	var buf bytes.Buffer
	gen.SetOutput(&buf)
	cmds := gen.GenerateCommands()
	if len(cmds) != 1 {
		t.Fatalf("commands = %d", len(cmds))
	}
	cmd := cmds[0]
	cmd.SetOut(io.Discard)
	cmd.SetErr(io.Discard)
	cmd.SilenceUsage = true
	cmd.SilenceErrors = true
	cmd.SetArgs(args)
	err := cmd.Execute()
	return buf.String(), err
}

func devNull(t *testing.T) *os.File {
	t.Helper()
	f, err := os.Open(os.DevNull)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = f.Close() })
	return f
}

func swapStdin(t *testing.T, f *os.File) func() {
	t.Helper()
	old := os.Stdin
	os.Stdin = f
	return func() { os.Stdin = old }
}
