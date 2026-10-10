package calc

import (
	"math"
	"testing"
)

func TestEvaluate(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		expr string
		want float64
	}{
		{"add", "2 + 2", 4},
		{"precedence", "2 + 3 * 4", 14},
		{"parens", "(2 + 3) * 4", 20},
		{"power_star", "2 ** 10", 1024},
		{"power_caret", "2^10", 1024},
		{"sqrt", "sqrt(16)", 4},
		{"pow_fn", "pow(2, 8)", 256},
		{"pi", "pi", math.Pi},
		{"e", "e", math.E},
		{"phi", "phi", math.Phi},
		{"trig", "sin(pi / 2)", 1},
		{"scientific", "1e2 + 3", 103},
		{"nested", "sqrt(pow(3, 2) + pow(4, 2))", 5},
		{"percentish", "17.5 * 3 / 2", 26.25},
		{"percent_of", "17.5% of 240", 42},
		{"percent_alone", "50%", 0.5},
		{"percent_times", "100 * 17.5%", 17.5},
		{"percent_sci_of", "1e2% of 50", 50},
		{"modulo_spaced", "10 % 3", 1},
		{"abs", "abs(-3)", 3},
		{"floor_ceil", "floor(3.9) + ceil(1.1)", 5},
		{"round", "round(2.5)", 3},
		{"log10", "log10(1000)", 3},
		{"min_max", "min(3, 1) + max(2, 9)", 10},
		{"deg_rad", "deg(rad(90))", 90},
		{"mod", "mod(10, 3)", 1},
		{"hypot", "hypot(3, 4)", 5},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := Evaluate(tc.expr)
			if err != nil {
				t.Fatalf("Evaluate(%q): %v", tc.expr, err)
			}
			if math.Abs(got-tc.want) > 1e-9 {
				t.Fatalf("Evaluate(%q) = %v, want %v", tc.expr, got, tc.want)
			}
		})
	}
}

func TestEvaluateErrors(t *testing.T) {
	t.Parallel()

	cases := []string{
		"",
		"   ",
		"2 +",
		"not_a_function(1)",
		"1 / 0",
		"sqrt(-1)",
	}
	for _, expr := range cases {
		t.Run(expr, func(t *testing.T) {
			t.Parallel()
			_, err := Evaluate(expr)
			if err == nil {
				t.Fatalf("Evaluate(%q) expected error", expr)
			}
		})
	}
}

func TestNormalizeExprPercent(t *testing.T) {
	t.Parallel()
	got := normalizeExpr("17.5% of 240")
	if got != "((17.5)/100)*240" {
		t.Fatalf("got %q", got)
	}
	got = normalizeExpr("10 % 3")
	if got != "10 % 3" {
		t.Fatalf("modulo rewritten unexpectedly: %q", got)
	}
}
