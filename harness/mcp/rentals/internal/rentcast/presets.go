package rentcast

import (
	"fmt"
	"sort"
	"strings"
)

// AreaPreset is a local neighborhood → zip / center mapping (no API call).
type AreaPreset struct {
	Name      string   `json:"name"`
	City      string   `json:"city"`
	State     string   `json:"state"`
	Zips      []string `json:"zips"`
	Latitude  float64  `json:"latitude,omitempty"`
	Longitude float64  `json:"longitude,omitempty"`
	Radius    float64  `json:"radius_miles,omitempty"` // default search radius when using lat/lng
	Aliases   []string `json:"aliases,omitempty"`
}

// AreaResolveRequest looks up neighborhood presets.
type AreaResolveRequest struct {
	Neighborhood string
	City         string
	State        string
	ListAll      bool
}

// AreaResolveResult is returned by areas_resolve (local, no network).
type AreaResolveResult struct {
	Areas []AreaPreset `json:"areas"`
	Count int          `json:"count"`
	Note  string       `json:"note,omitempty"`
}

const (
	defaultNeighborhoodRadius = 1.5
	citySeattle               = "Seattle"
	stateWA                   = "WA"
)

func sea(name string, zips []string, lat, lng, radius float64, aliases ...string) AreaPreset {
	return AreaPreset{
		Name: name, City: citySeattle, State: stateWA,
		Zips: zips, Latitude: lat, Longitude: lng, Radius: radius, Aliases: aliases,
	}
}

// seattleNeighborhoods is the first-use metro; other cities can be added later.
var seattleNeighborhoods = []AreaPreset{
	sea("Capitol Hill", []string{"98102", "98122"}, 47.6253, -122.3222, 1.5, "cap hill", "capitolhill"),
	sea("Ballard", []string{"98107", "98117"}, 47.6687, -122.3830, 1.5),
	sea("Fremont", []string{"98103"}, 47.6510, -122.3490, 1.2),
	sea("Queen Anne", []string{"98109", "98119"}, 47.6370, -122.3570, 1.5),
	sea("University District", []string{"98105"}, 47.6625, -122.3132, 1.3, "u district", "udistrict", "u-district"),
	sea("Wallingford", []string{"98103"}, 47.6610, -122.3330, 1.2),
	sea("Green Lake", []string{"98103", "98115"}, 47.6800, -122.3280, 1.3),
	sea("Phinney Ridge", []string{"98103", "98117"}, 47.6750, -122.3540, 1.2),
	sea("Greenwood", []string{"98103", "98117", "98133"}, 47.6900, -122.3550, 1.5),
	sea("Magnolia", []string{"98199"}, 47.6500, -122.4000, 1.8),
	sea("West Seattle", []string{"98116", "98126", "98136"}, 47.5660, -122.3860, 2.5),
	sea("Beacon Hill", []string{"98108", "98118", "98144"}, 47.5620, -122.3080, 2.0),
	sea("Columbia City", []string{"98118"}, 47.5580, -122.2860, 1.3),
	sea("Central District", []string{"98122"}, 47.6060, -122.3020, 1.5, "cd", "central district seattle"),
	sea("First Hill", []string{"98101", "98104", "98122"}, 47.6080, -122.3230, 1.0),
	sea("Belltown", []string{"98121"}, 47.6140, -122.3450, 0.8),
	sea("Downtown", []string{"98101", "98104", "98121"}, 47.6062, -122.3321, 1.2, "downtown seattle"),
	sea("South Lake Union", []string{"98109"}, 47.6250, -122.3360, 1.0, "slu"),
	sea("Madrona", []string{"98122"}, 47.6130, -122.2900, 1.0),
	sea("Madison Park", []string{"98112"}, 47.6350, -122.2800, 1.2),
	sea("Ravenna", []string{"98115"}, 47.6750, -122.3020, 1.3),
	sea("Roosevelt", []string{"98115"}, 47.6770, -122.3160, 1.0),
	sea("Northgate", []string{"98125"}, 47.7080, -122.3250, 1.5),
	sea("Lake City", []string{"98125", "98155"}, 47.7190, -122.2950, 1.5),
	sea("Mount Baker", []string{"98144"}, 47.5780, -122.2880, 1.2),
	sea("Rainier Valley", []string{"98118", "98144"}, 47.5500, -122.2800, 2.0),
	sea("Georgetown", []string{"98108"}, 47.5440, -122.3270, 1.2),
	sea("International District", []string{"98104"}, 47.5980, -122.3250, 0.8, "id", "chinatown", "chinatown-international district"),
	sea("Pioneer Square", []string{"98104"}, 47.6010, -122.3330, 0.7),
	sea("Eastlake", []string{"98102"}, 47.6410, -122.3250, 1.0),
}

var allAreaPresets = seattleNeighborhoods

// ResolveAreas looks up local neighborhood presets (no network).
func ResolveAreas(req AreaResolveRequest) (*AreaResolveResult, error) {
	city := strings.TrimSpace(req.City)
	state := strings.ToUpper(strings.TrimSpace(req.State))
	nb := normalizeAreaKey(req.Neighborhood)

	matches := make([]AreaPreset, 0)
	for _, a := range allAreaPresets {
		if city != "" && !strings.EqualFold(a.City, city) {
			continue
		}
		if state != "" && !strings.EqualFold(a.State, state) {
			continue
		}
		if req.ListAll || nb == "" {
			matches = append(matches, copyArea(a))
			continue
		}
		if areaMatches(a, nb) {
			matches = append(matches, copyArea(a))
		}
	}

	sort.SliceStable(matches, func(i, j int) bool {
		return matches[i].Name < matches[j].Name
	})

	if nb != "" && !req.ListAll && len(matches) == 0 {
		hint := "Try areas_resolve with list_all=true"
		if city == "" && state == "" {
			hint += " (Seattle WA presets are built in)"
		}
		return nil, fmt.Errorf("unknown neighborhood %q — %s", req.Neighborhood, hint)
	}

	note := "Local presets only (no API). Use returned zips / lat/lng with listings_search. Seattle is the first metro; more cities can be added later."
	if nb != "" && len(matches) == 1 {
		note = fmt.Sprintf("Resolved %s → zips %s. Prefer listings_search with neighborhood=%q (one API call via lat/lng).",
			matches[0].Name, strings.Join(matches[0].Zips, ", "), matches[0].Name)
	}

	return &AreaResolveResult{
		Areas: matches,
		Count: len(matches),
		Note:  note,
	}, nil
}

// LookupNeighborhood returns the best matching preset, or nil.
func LookupNeighborhood(name, city, state string) *AreaPreset {
	res, err := ResolveAreas(AreaResolveRequest{
		Neighborhood: name,
		City:         city,
		State:        state,
	})
	if err != nil || res == nil || len(res.Areas) == 0 {
		return nil
	}
	// Prefer exact name match when multiple.
	key := normalizeAreaKey(name)
	for i := range res.Areas {
		if normalizeAreaKey(res.Areas[i].Name) == key {
			a := res.Areas[i]
			return &a
		}
	}
	a := res.Areas[0]
	return &a
}

func areaMatches(a AreaPreset, key string) bool {
	if normalizeAreaKey(a.Name) == key || strings.Contains(normalizeAreaKey(a.Name), key) {
		return true
	}
	for _, al := range a.Aliases {
		if normalizeAreaKey(al) == key {
			return true
		}
	}
	return false
}

func normalizeAreaKey(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "-", " ")
	s = strings.ReplaceAll(s, "_", " ")
	return strings.Join(strings.Fields(s), " ")
}

func copyArea(a AreaPreset) AreaPreset {
	out := a
	if len(a.Zips) > 0 {
		out.Zips = append([]string(nil), a.Zips...)
	}
	if len(a.Aliases) > 0 {
		out.Aliases = append([]string(nil), a.Aliases...)
	}
	if out.Radius <= 0 && out.Latitude != 0 {
		out.Radius = defaultNeighborhoodRadius
	}
	return out
}

// ParseZipList splits comma/pipe/space separated zip codes.
func ParseZipList(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	raw = strings.ReplaceAll(raw, "|", ",")
	raw = strings.ReplaceAll(raw, ";", ",")
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\t'
	})
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if len(p) < 5 {
			continue
		}
		// Keep 5-digit form when ZIP+4 given.
		if len(p) > 5 && p[5] == '-' {
			p = p[:5]
		}
		if len(p) != 5 || seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	return out
}
