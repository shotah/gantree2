package garmin

import (
	"strings"
)

// ClimbGradeValue is a Garmin climbing grade on a typed split or split summary.
// Scales seen in Connect: VERMIN (V-scale), YDS, FONT.
type ClimbGradeValue struct {
	SortOrder int    `json:"sortOrder"`
	ValueKey  string `json:"valueKey"`
	Scale     string `json:"scale"`
}

// Display returns a human-readable grade (e.g. "V3", "5.11d", "Font 4").
func (g *ClimbGradeValue) Display() string {
	if g == nil || g.ValueKey == "" {
		return ""
	}
	switch strings.ToUpper(g.Scale) {
	case "VERMIN":
		return g.ValueKey
	case "YDS":
		key := strings.TrimPrefix(g.ValueKey, "_")
		parts := strings.SplitN(key, "_", 2)
		if len(parts) == 2 {
			return parts[0] + "." + strings.ToLower(parts[1])
		}
		return key
	case "FONT":
		return "Font " + strings.TrimPrefix(g.ValueKey, "_")
	default:
		if g.Scale == "" {
			return g.ValueKey
		}
		return g.Scale + ":" + g.ValueKey
	}
}
