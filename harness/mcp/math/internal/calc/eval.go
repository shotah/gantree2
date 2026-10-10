// Package calc evaluates arithmetic expressions and converts units.
package calc

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"

	"github.com/expr-lang/expr"
	"github.com/expr-lang/expr/vm"
)

// mathEnv is the only symbols available to expressions — no I/O, no imports.
var mathEnv = map[string]any{
	"pi":    math.Pi,
	"e":     math.E,
	"phi":   math.Phi,
	"abs":   math.Abs,
	"acos":  math.Acos,
	"asin":  math.Asin,
	"atan":  math.Atan,
	"atan2": math.Atan2,
	"ceil":  math.Ceil,
	"cos":   math.Cos,
	"cosh":  math.Cosh,
	"exp":   math.Exp,
	"floor": math.Floor,
	"hypot": math.Hypot,
	"log":   math.Log,
	"log10": math.Log10,
	"log2":  math.Log2,
	"max":   math.Max,
	"min":   math.Min,
	"mod":   math.Mod,
	"pow":   math.Pow,
	"round": math.Round,
	"sin":   math.Sin,
	"sinh":  math.Sinh,
	"sqrt":  math.Sqrt,
	"tan":   math.Tan,
	"tanh":  math.Tanh,
	"trunc": math.Trunc,
	"deg":   func(r float64) float64 { return r * 180 / math.Pi },
	"rad":   func(d float64) float64 { return d * math.Pi / 180 },
}

var programOpts = []expr.Option{
	expr.Env(mathEnv),
	expr.AsFloat64(),
}

// Number token used in percentage rewrites (supports decimals + scientific).
const numPat = `(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)`

var (
	// 17.5% of 240 → ((17.5)/100)*240
	percentOfRE = regexp.MustCompile(`(?i)` + numPat + `\s*%\s*of\s*`)
	// 17.5% → ((17.5)/100)  (no space before %; "10 % 3" stays modulo)
	percentRE = regexp.MustCompile(numPat + `%`)
)

// Evaluate runs a math expression and returns a finite float64.
// Supports + - * / % ** (and ^ as power), parentheses, percentages
// ("17.5% of 240", "50%"), and the functions in mathEnv plus constants pi, e, phi.
func Evaluate(expression string) (float64, error) {
	code := normalizeExpr(expression)
	if code == "" {
		return 0, errors.New("expression is required")
	}

	program, err := expr.Compile(code, programOpts...)
	if err != nil {
		return 0, fmt.Errorf("invalid expression: %w", err)
	}
	return runFloat(program)
}

func runFloat(program *vm.Program) (float64, error) {
	out, err := expr.Run(program, mathEnv)
	if err != nil {
		return 0, fmt.Errorf("evaluation failed: %w", err)
	}
	f, ok := out.(float64)
	if !ok {
		return 0, fmt.Errorf("result is not a number: %T", out)
	}
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0, errors.New("result is not finite")
	}
	return f, nil
}

// normalizeExpr rewrites LLM-friendly sugar before expr compilation.
func normalizeExpr(expression string) string {
	s := strings.TrimSpace(expression)
	if s == "" {
		return ""
	}
	// Calculator semantics: ^ means power, not bitwise XOR.
	s = strings.ReplaceAll(s, "^", "**")
	// Percentages before remaining % tokens (modulo keeps spaces: "10 % 3").
	s = percentOfRE.ReplaceAllString(s, "(($1)/100)*")
	s = percentRE.ReplaceAllString(s, "(($1)/100)")
	return s
}
