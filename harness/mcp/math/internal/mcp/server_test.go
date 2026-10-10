package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestEvaluateTool(t *testing.T) {
	t.Parallel()
	s := New()
	_, out, err := s.evaluate(context.Background(), nil, evaluateInput{Expression: "2^10"})
	if err != nil {
		t.Fatal(err)
	}
	if out.Result != 1024 {
		t.Fatalf("got %+v", out)
	}
	if out.ResultText != "1024" {
		t.Fatalf("result_text=%q", out.ResultText)
	}
}

func TestEvaluateToolError(t *testing.T) {
	t.Parallel()
	s := New()
	res, _, err := s.evaluate(context.Background(), nil, evaluateInput{Expression: "1/"})
	if err != nil {
		t.Fatal(err)
	}
	if res == nil || !res.IsError {
		t.Fatal("expected tool error result")
	}
}

func TestConvertTool(t *testing.T) {
	t.Parallel()
	s := New()
	_, out, err := s.convert(context.Background(), nil, convertInput{
		Value: 32, From: "F", To: "C",
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.Result != 0 {
		t.Fatalf("got %+v", out)
	}
}

func TestConvertToolError(t *testing.T) {
	t.Parallel()
	s := New()
	res, _, err := s.convert(context.Background(), nil, convertInput{
		Value: 1, From: "mi", To: "kg",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res == nil || !res.IsError {
		t.Fatal("expected tool error result")
	}
}

func TestSelfTest(t *testing.T) {
	t.Parallel()
	if err := SelfTest(); err != nil {
		t.Fatal(err)
	}
}

func TestFormatFloat(t *testing.T) {
	t.Parallel()
	if got := formatFloat(4); got != "4" {
		t.Fatalf("got %q", got)
	}
	if got := formatFloat(2.5); got != "2.5" {
		t.Fatalf("got %q", got)
	}
}

func TestServeViaInMemoryTransport(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	s := New()
	t1, t2 := sdkmcp.NewInMemoryTransports()

	errCh := make(chan error, 1)
	go func() {
		errCh <- s.serve(ctx, t1)
	}()

	client := sdkmcp.NewClient(&sdkmcp.Implementation{Name: "test", Version: "v0"}, nil)
	clientSession, err := client.Connect(ctx, t2, nil)
	if err != nil {
		t.Fatalf("client connect: %v", err)
	}

	tools, err := clientSession.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	if len(tools.Tools) != 2 {
		t.Fatalf("tools=%d want 2", len(tools.Tools))
	}

	evalRes, err := clientSession.CallTool(ctx, &sdkmcp.CallToolParams{
		Name:      "expression_evaluate",
		Arguments: map[string]any{"expression": "2 + 2"},
	})
	if err != nil {
		t.Fatalf("expression_evaluate: %v", err)
	}
	if evalRes.IsError {
		t.Fatalf("expression_evaluate error: %+v", evalRes)
	}
	assertStructuredResult(t, evalRes, 4)

	convRes, err := clientSession.CallTool(ctx, &sdkmcp.CallToolParams{
		Name: "units_convert",
		Arguments: map[string]any{
			"value": 1.0,
			"from":  "mi",
			"to":    "km",
		},
	})
	if err != nil {
		t.Fatalf("units_convert: %v", err)
	}
	if convRes.IsError {
		t.Fatalf("units_convert error: %+v", convRes)
	}

	_ = clientSession.Close()
	cancel()
	select {
	case err := <-errCh:
		if err != nil && !errors.Is(err, context.Canceled) {
			t.Fatalf("serve: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("serve did not exit")
	}
}

func assertStructuredResult(t *testing.T, res *sdkmcp.CallToolResult, want float64) {
	t.Helper()
	if res.StructuredContent == nil {
		// Fallback: some SDK paths only populate text content.
		if len(res.Content) == 0 {
			t.Fatal("empty tool result")
		}
		return
	}
	raw, err := json.Marshal(res.StructuredContent)
	if err != nil {
		t.Fatal(err)
	}
	var out evaluateOutput
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal %s: %v", raw, err)
	}
	if out.Result != want {
		t.Fatalf("result=%v want %v", out.Result, want)
	}
}

// Ensure CallToolResult content type stays compatible with SDK.
var _ sdkmcp.Content = (*sdkmcp.TextContent)(nil)
