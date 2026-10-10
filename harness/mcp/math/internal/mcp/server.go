package mcp

import (
	"context"
	"fmt"
	"log"
	"math"
	"os"
	"strconv"

	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/shotah/mcp-go-math/internal/calc"
)

const ServerName = "mcp-go-math"

const (
	toolExpressionEvaluate = "expression_evaluate"
	toolUnitsConvert       = "units_convert"
)

// RegisteredToolNames is the MCP catalog in registration order.
func RegisteredToolNames() []string {
	return []string{toolExpressionEvaluate, toolUnitsConvert}
}

// ServerVersion is set at build time via ldflags.
var ServerVersion = "dev"

// Server is the stdio MCP calculator surface.
type Server struct {
	Log *log.Logger
}

// New creates an MCP server.
func New() *Server {
	return &Server{
		Log: log.New(os.Stderr, "mcp-go-math: ", log.LstdFlags|log.Lmsgprefix),
	}
}

// newMCPServer builds the protocol server with tools registered.
func (s *Server) newMCPServer() *sdkmcp.Server {
	server := sdkmcp.NewServer(&sdkmcp.Implementation{
		Name:    ServerName,
		Version: ServerVersion,
	}, nil)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: toolExpressionEvaluate,
		Description: "Evaluate a mathematical expression and return the numeric result. " +
			"Use this for any arithmetic beyond trivial mental math — do not guess. " +
			"Supports + - * / % ** (or ^ for power), parentheses, scientific notation, " +
			"percentages (17.5% of 240, 50%, 100*17.5%), constants pi/e/phi, and functions: " +
			"abs, sqrt, pow, sin, cos, tan, asin, acos, atan, atan2, " +
			"log, log10, log2, exp, floor, ceil, round, trunc, min, max, mod, hypot, sinh, cosh, tanh, " +
			"deg (radians→degrees), rad (degrees→radians). Angles for trig are in radians. " +
			"Modulo needs spaces around % (10 % 3) or use mod(10, 3).",
	}, s.evaluate)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: toolUnitsConvert,
		Description: "Convert a numeric value between units (length, mass, temperature, volume, etc.). " +
			"Examples: 5 mi→km, 220 lb→kg, 32 F→C, 1 us_gallon→liter. " +
			"Use common unit names or symbols (mi, km, lb, kg, F, C, liter). " +
			"Volume: gallon/gal = imperial (UK, 4.54609 L); us_gallon/us_gal/fluid gallon = US liquid (3.785411784 L).",
	}, s.convert)

	return server
}

// Run starts the MCP server over stdio. Logs go to stderr only.
func (s *Server) Run(ctx context.Context) error {
	return s.serve(ctx, &sdkmcp.StdioTransport{})
}

func (s *Server) serve(ctx context.Context, transport sdkmcp.Transport) error {
	server := s.newMCPServer()
	s.Log.Printf("starting stdio MCP (%s %s) tools=%s,%s", ServerName, ServerVersion, toolExpressionEvaluate, toolUnitsConvert)
	return server.Run(ctx, transport)
}

type evaluateInput struct {
	Expression string `json:"expression" jsonschema:"Mathematical expression to evaluate, e.g. (17.5 * 3) / 2 or sqrt(2^10)"`
}

type evaluateOutput struct {
	Expression string  `json:"expression"`
	Result     float64 `json:"result"`
	ResultText string  `json:"result_text"`
}

func (s *Server) evaluate(_ context.Context, _ *sdkmcp.CallToolRequest, in evaluateInput) (*sdkmcp.CallToolResult, evaluateOutput, error) {
	result, err := calc.Evaluate(in.Expression)
	if err != nil {
		return toolError(err.Error()), evaluateOutput{}, nil
	}
	return nil, evaluateOutput{
		Expression: in.Expression,
		Result:     result,
		ResultText: formatFloat(result),
	}, nil
}

type convertInput struct {
	Value float64 `json:"value" jsonschema:"Numeric value to convert"`
	From  string  `json:"from" jsonschema:"Source unit name or symbol (e.g. mi, lb, F)"`
	To    string  `json:"to" jsonschema:"Target unit name or symbol (e.g. km, kg, C)"`
}

type convertOutput struct {
	Value      float64 `json:"value"`
	From       string  `json:"from"`
	To         string  `json:"to"`
	Result     float64 `json:"result"`
	ResultText string  `json:"result_text"`
	Label      string  `json:"label"`
}

func (s *Server) convert(_ context.Context, _ *sdkmcp.CallToolRequest, in convertInput) (*sdkmcp.CallToolResult, convertOutput, error) {
	out, err := calc.Convert(in.Value, in.From, in.To)
	if err != nil {
		return toolError(err.Error()), convertOutput{}, nil
	}
	return nil, convertOutput{
		Value:      in.Value,
		From:       out.From,
		To:         out.To,
		Result:     out.Value,
		ResultText: formatFloat(out.Value),
		Label:      out.Label,
	}, nil
}

func toolError(msg string) *sdkmcp.CallToolResult {
	return &sdkmcp.CallToolResult{
		IsError: true,
		Content: []sdkmcp.Content{&sdkmcp.TextContent{Text: msg}},
	}
}

func formatFloat(f float64) string {
	if f == math.Trunc(f) && math.Abs(f) < 1e15 {
		return strconv.FormatInt(int64(f), 10)
	}
	return strconv.FormatFloat(f, 'g', 15, 64)
}

// SelfTest runs evaluate + convert smoke checks (no network).
func SelfTest() error {
	fmt.Fprintf(os.Stderr, "version=%s\n", ServerVersion)

	v, err := calc.Evaluate("2 + 2")
	if err != nil {
		return fmt.Errorf("evaluate smoke failed: %w", err)
	}
	if v != 4 {
		return fmt.Errorf("evaluate smoke: got %v want 4", v)
	}
	fmt.Fprintf(os.Stderr, "evaluate_smoke=ok result=%v\n", v)

	c, err := calc.Convert(1, "mi", "km")
	if err != nil {
		return fmt.Errorf("convert smoke failed: %w", err)
	}
	fmt.Fprintf(os.Stderr, "convert_smoke=ok result=%v\n", c.Value)
	return nil
}
