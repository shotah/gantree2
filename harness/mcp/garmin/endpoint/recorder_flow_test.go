package endpoint

import (
	"context"
	"errors"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"gopkg.in/dnaeon/go-vcr.v4/pkg/recorder"
)

func TestFixtureRecorderFlows(t *testing.T) {
	when := time.Date(2026, 5, 6, 0, 0, 0, 0, time.UTC)
	dir := t.TempDir()
	newRec := func(name string) (*recorder.Recorder, error) {
		return recorder.New(filepath.Join(dir, name), recorder.WithMode(recorder.ModeRecordOnly))
	}

	t.Run("records in dependency order and skips empty extras", func(t *testing.T) {
		var order []string
		r := NewRegistry()
		r.Register(allParamEndpoint("Child", "demo", "Parent", func(_ context.Context, client any, args *HandlerArgs) (any, error) {
			if client != "loaded" {
				t.Fatalf("client %v", client)
			}
			if !args.Date("date").Equal(when) || !args.Date("start").Equal(when.AddDate(0, 0, -7)) || !args.Date("end").Equal(when) {
				t.Fatalf("dates %#v", args.Params)
			}
			if args.Int("limit") != 10 || args.String("q") != "" || args.Bool("verbose") {
				t.Fatalf("defaults %#v", args.Params)
			}
			order = append(order, "child")
			return map[string]string{"from": "child"}, nil
		}))
		r.Register(Endpoint{
			Name:     "Parent",
			Cassette: "demo",
			Handler: func(context.Context, any, *HandlerArgs) (any, error) {
				order = append(order, "parent")
				return map[string]string{"id": "1"}, nil
			},
		})
		r.Register(Endpoint{
			Name:      "Skip",
			Cassette:  "demo",
			DependsOn: "Parent",
			ArgProvider: func(any) map[string]any {
				return nil
			},
			Handler: func(context.Context, any, *HandlerArgs) (any, error) {
				t.Fatal("skipped endpoint ran")
				return nil, nil
			},
		})
		r.Register(Endpoint{
			Name:     "Warn",
			Cassette: "demo",
			Handler: func(context.Context, any, *HandlerArgs) (any, error) {
				order = append(order, "warn")
				return nil, errors.New("boom")
			},
		})
		r.Register(Endpoint{
			Name:     "Ignored",
			Cassette: "",
			Handler: func(context.Context, any, *HandlerArgs) (any, error) {
				t.Fatal("empty cassette recorded")
				return nil, nil
			},
		})
		// Cycle: each points at the other and both still finish.
		r.Register(Endpoint{
			Name:      "LoopA",
			Cassette:  "loops",
			DependsOn: "LoopB",
			Handler: func(context.Context, any, *HandlerArgs) (any, error) {
				return "a", nil
			},
		})
		r.Register(Endpoint{
			Name:      "LoopB",
			Cassette:  "loops",
			DependsOn: "LoopA",
			Handler: func(context.Context, any, *HandlerArgs) (any, error) {
				return "b", nil
			},
		})

		rec := NewFixtureRecorder(r, RecorderConfig{
			Session:     []byte(`{}`),
			Date:        when,
			NewRecorder: newRec,
			HTTPClient:  func(*recorder.Recorder) *http.Client { return &http.Client{} },
			ClientLoader: func(*http.Client, []byte) (any, error) {
				return "loaded", nil
			},
		})
		names := rec.ListCassettes()
		if len(names) != 2 {
			t.Fatalf("cassettes %#v", names)
		}
		if err := rec.RecordAll(context.Background()); err != nil {
			t.Fatal(err)
		}
		if len(order) != 3 || order[0] != "parent" {
			t.Fatalf("order %#v", order)
		}
	})

	t.Run("unknown cassette", func(t *testing.T) {
		rec := NewFixtureRecorder(NewRegistry(), RecorderConfig{NewRecorder: newRec})
		err := rec.RecordCassette(context.Background(), "missing")
		if err == nil || err.Error() != "no endpoints found for cassette: missing" {
			t.Fatalf("err=%v", err)
		}
	})

	t.Run("recorder error", func(t *testing.T) {
		r := NewRegistry()
		r.Register(Endpoint{Name: "A", Cassette: "bad", Handler: func(context.Context, any, *HandlerArgs) (any, error) {
			return nil, nil
		}})
		rec := NewFixtureRecorder(r, RecorderConfig{
			NewRecorder: func(string) (*recorder.Recorder, error) {
				return nil, errors.New("disk")
			},
		})
		if err := rec.RecordAll(context.Background()); err == nil || err.Error() != "bad: disk" {
			t.Fatalf("err=%v", err)
		}
	})

	t.Run("client loader error", func(t *testing.T) {
		r := NewRegistry()
		r.Register(Endpoint{Name: "A", Cassette: "load", Handler: func(context.Context, any, *HandlerArgs) (any, error) {
			t.Fatal("handler ran")
			return nil, nil
		}})
		rec := NewFixtureRecorder(r, RecorderConfig{
			NewRecorder: newRec,
			HTTPClient:  func(*recorder.Recorder) *http.Client { return &http.Client{} },
			ClientLoader: func(*http.Client, []byte) (any, error) {
				return nil, errors.New("session")
			},
		})
		err := rec.RecordCassette(context.Background(), "load")
		if err == nil || err.Error() != "failed to load client: session" {
			t.Fatalf("err=%v", err)
		}
	})
}

func allParamEndpoint(name, cassette, depends string, handler func(context.Context, any, *HandlerArgs) (any, error)) Endpoint {
	return Endpoint{
		Name:      name,
		Cassette:  cassette,
		DependsOn: depends,
		Params: []Param{
			{Name: "date", Type: ParamTypeDate},
			{Name: "range", Type: ParamTypeDateRange},
			{Name: "limit", Type: ParamTypeInt},
			{Name: "other", Type: ParamTypeInt},
			{Name: "q", Type: ParamTypeString},
			{Name: "verbose", Type: ParamTypeBool},
		},
		Handler: handler,
	}
}
