package calc

import (
	"math"
	"testing"
)

func TestConvert(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		value     float64
		from, to  string
		want      float64
		tolerance float64
	}{
		{"miles_to_km", 1, "mi", "km", 1.609344, 1e-6},
		{"lb_to_kg", 220, "lb", "kg", 99.7903216, 1e-4},
		{"F_to_C", 32, "F", "C", 0, 1e-9},
		{"imperial_gallon_to_liter", 1, "gallon", "liter", 4.54609, 1e-5},
		{"us_gallon_to_liter", 1, "us_gallon", "liter", 3.785411784, 1e-9},
		{"us_gal_alias", 1, "us_gal", "liter", 3.785411784, 1e-9},
		{"fluid_gallon", 1, "fluid gallon", "liter", 3.785411784, 1e-9},
		{"us_gallon_spaced", 1, "US gallon", "liter", 3.785411784, 1e-9},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := Convert(tc.value, tc.from, tc.to)
			if err != nil {
				t.Fatalf("Convert: %v", err)
			}
			if math.Abs(got.Value-tc.want) > tc.tolerance {
				t.Fatalf("got %v, want %v (±%v)", got.Value, tc.want, tc.tolerance)
			}
			if got.From == "" || got.To == "" || got.Label == "" {
				t.Fatalf("missing fields: %+v", got)
			}
		})
	}
}

func TestConvertErrors(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		value    float64
		from, to string
	}{
		{"empty_from", 1, "", "km"},
		{"empty_to", 1, "mi", ""},
		{"incompatible", 1, "mi", "kg"},
		{"unknown", 1, "nope", "km"},
		{"nan", math.NaN(), "mi", "km"},
		{"inf", math.Inf(1), "mi", "km"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if _, err := Convert(tc.value, tc.from, tc.to); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}

func TestResolveUnit(t *testing.T) {
	t.Parallel()
	if got := resolveUnit("us_gallon"); got != usFluidGallon {
		t.Fatalf("got %q", got)
	}
	if got := resolveUnit("gallon"); got != "gallon" {
		t.Fatalf("imperial gallon should stay: %q", got)
	}
}
