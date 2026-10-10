package calc

import (
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/bcicen/go-units"
)

// ConvertResult is a successful unit conversion.
type ConvertResult struct {
	Value float64 `json:"value"`
	From  string  `json:"from"`
	To    string  `json:"to"`
	Label string  `json:"label"`
}

// go-units name for US liquid gallon (3.785411784 L). Bare "gallon" is imperial.
const usFluidGallon = "fluid gallon"

// unitAliases maps common LLM/US spellings onto go-units names.
// Note: bare "gallon"/"gal" remain imperial (UK); use us_gallon for US liquid.
var unitAliases = map[string]string{
	"us_gallon":     usFluidGallon,
	"us-gallon":     usFluidGallon,
	"us gallon":     usFluidGallon,
	"us_gal":        usFluidGallon,
	"us-gal":        usFluidGallon,
	"usgal":         usFluidGallon,
	"liquid gallon": usFluidGallon,
	"liquid_gallon": usFluidGallon,
}

// Convert converts value from one unit to another (e.g. 5 mi → km).
// Unit names are go-units names/symbols (case-insensitive), e.g. "mi", "km",
// "lb", "kg", "F", "C", "gallon" (imperial), "us_gallon" (US liquid), "liter".
func Convert(value float64, from, to string) (ConvertResult, error) {
	from = resolveUnit(from)
	to = resolveUnit(to)
	if from == "" || to == "" {
		return ConvertResult{}, errors.New("from and to units are required")
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return ConvertResult{}, errors.New("value must be a finite number")
	}

	fromUnit, err := units.Find(from)
	if err != nil {
		return ConvertResult{}, fmt.Errorf("unknown from unit %q: %w", from, err)
	}
	toUnit, err := units.Find(to)
	if err != nil {
		return ConvertResult{}, fmt.Errorf("unknown to unit %q: %w", to, err)
	}

	converted, err := units.NewValue(value, fromUnit).Convert(toUnit)
	if err != nil {
		return ConvertResult{}, fmt.Errorf("cannot convert %s → %s: %w", fromUnit.Name, toUnit.Name, err)
	}

	f := converted.Float()
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return ConvertResult{}, errors.New("converted result is not finite")
	}

	return ConvertResult{
		Value: f,
		From:  fromUnit.Name,
		To:    toUnit.Name,
		Label: converted.Fmt(units.FmtOptions{Label: true, Short: true, Precision: 6}),
	}, nil
}

func resolveUnit(name string) string {
	s := strings.TrimSpace(name)
	if s == "" {
		return ""
	}
	if canon, ok := unitAliases[strings.ToLower(s)]; ok {
		return canon
	}
	return s
}
