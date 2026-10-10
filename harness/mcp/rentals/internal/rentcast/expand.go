package rentcast

import (
	"fmt"
	"strconv"
	"strings"
)

const amenityUnsupportedNote = "RentCast listings API does not expose pet/parking/laundry filters — verify with the listing agent/office."

// ExpandSearchRequest applies neighborhood presets, multi-zip parsing, and
// new-this-week / days-old helpers before the HTTP call.
//
// Quota rule: multi-zip / multi-neighborhood always collapses to ONE RentCast
// request (city+state or a single geo center) plus local zip filtering.
func ExpandSearchRequest(req ListingsSearchRequest) (ListingsSearchRequest, []string, error) {
	notes := make([]string, 0, 4)

	zips := ParseZipList(req.ZipCodes)
	if z := strings.TrimSpace(req.ZipCode); z != "" {
		zips = mergeZips(zips, ParseZipList(z))
	}

	var err error
	req, zips, notes, err = applyNeighborhoods(req, zips, notes)
	if err != nil {
		return req, nil, err
	}

	switch {
	case len(zips) == 1 && strings.TrimSpace(req.ZipCode) == "":
		req.ZipCode = zips[0]
	case len(zips) > 1:
		// One API call: never pin a single zipCode when filtering many zips.
		req.ZipCode = ""
		switch {
		case req.Latitude != 0 || req.Longitude != 0:
			notes = append(notes, "thrifty: one geo API call, client filter to zip_filter")
		case strings.TrimSpace(req.City) != "" && strings.TrimSpace(req.State) != "":
			notes = append(notes, "thrifty: one city+state API call, client filter to zip_filter")
		case strings.TrimSpace(req.Address) != "":
			notes = append(notes, "thrifty: one address/radius API call, client filter to zip_filter")
		default:
			req.ZipCode = zips[0]
			notes = append(notes, fmt.Sprintf("thrifty: one API call via primary zip %s (pass city+state to cover all zips once)", zips[0]))
		}
	}
	req.ZipFilter = zips

	if req.NewThisWeek && strings.TrimSpace(req.DaysOld) == "" && req.DaysOldMax <= 0 {
		req.DaysOldMax = 7
		notes = append(notes, "new_this_week → days_old_max=7")
	}
	if req.DaysOldMax > 0 && strings.TrimSpace(req.DaysOld) == "" {
		req.DaysOld = strconv.Itoa(req.DaysOldMax)
	}

	if req.PetsWanted || req.ParkingWanted || req.LaundryWanted {
		notes = append(notes, amenityUnsupportedNote)
	}

	return req, notes, nil
}

func applyNeighborhoods(req ListingsSearchRequest, zips, notes []string) (ListingsSearchRequest, []string, []string, error) {
	names := parseNeighborhoodList(req.Neighborhood)
	if len(names) == 0 {
		return req, zips, notes, nil
	}
	if len(names) == 1 {
		return applyOneNeighborhood(req, names[0], zips, notes)
	}

	// Multi-neighborhood → merge zips, force ONE city+state search (not N geo calls).
	resolved := make([]string, 0, len(names))
	for _, name := range names {
		area := LookupNeighborhood(name, req.City, req.State)
		if area == nil {
			return req, zips, notes, fmt.Errorf("unknown neighborhood %q — call areas_resolve (list_all=true) for Seattle presets", name)
		}
		resolved = append(resolved, area.Name)
		if strings.TrimSpace(req.City) == "" {
			req.City = area.City
		}
		if strings.TrimSpace(req.State) == "" {
			req.State = area.State
		}
		zips = mergeZips(zips, area.Zips)
	}
	req.Neighborhood = strings.Join(resolved, ", ")
	// Clear geo pin so we don't do a tiny single-neighborhood radius.
	req.Latitude = 0
	req.Longitude = 0
	req.Radius = 0
	notes = append(notes, fmt.Sprintf("neighborhoods [%s] → one search, filter zips %s",
		req.Neighborhood, strings.Join(zips, ", ")))
	return req, zips, notes, nil
}

func applyOneNeighborhood(req ListingsSearchRequest, name string, zips, notes []string) (ListingsSearchRequest, []string, []string, error) {
	area := LookupNeighborhood(name, req.City, req.State)
	if area == nil {
		return req, zips, notes, fmt.Errorf("unknown neighborhood %q — call areas_resolve (list_all=true) for Seattle presets", name)
	}
	req.Neighborhood = area.Name
	if strings.TrimSpace(req.City) == "" {
		req.City = area.City
	}
	if strings.TrimSpace(req.State) == "" {
		req.State = area.State
	}
	zips = mergeZips(zips, area.Zips)

	explicitZips := len(ParseZipList(req.ZipCodes)) > 0
	useGeo := area.Latitude != 0 && area.Longitude != 0 &&
		req.Latitude == 0 && req.Longitude == 0 &&
		strings.TrimSpace(req.ZipCode) == "" &&
		!explicitZips

	switch {
	case useGeo:
		req.Latitude = area.Latitude
		req.Longitude = area.Longitude
		if req.Radius <= 0 {
			req.Radius = area.Radius
			if req.Radius <= 0 {
				req.Radius = defaultNeighborhoodRadius
			}
		}
		notes = append(notes, fmt.Sprintf("neighborhood %s → lat/lng + %.1f mi radius (1 API call)", area.Name, req.Radius))
	case len(area.Zips) == 1 && strings.TrimSpace(req.ZipCode) == "":
		req.ZipCode = area.Zips[0]
		notes = append(notes, fmt.Sprintf("neighborhood %s → zip %s (1 API call)", area.Name, area.Zips[0]))
	case len(area.Zips) > 1:
		notes = append(notes, fmt.Sprintf("neighborhood %s → filter zips %s (1 API call)", area.Name, strings.Join(area.Zips, ", ")))
	}
	return req, zips, notes, nil
}

func parseNeighborhoodList(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	raw = strings.ReplaceAll(raw, "|", ",")
	raw = strings.ReplaceAll(raw, ";", ",")
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		key := normalizeAreaKey(p)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, p)
	}
	return out
}

func mergeZips(a, b []string) []string {
	if len(a) == 0 {
		return append([]string(nil), b...)
	}
	if len(b) == 0 {
		return append([]string(nil), a...)
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(a)+len(b))
	for _, z := range a {
		if !seen[z] {
			seen[z] = true
			out = append(out, z)
		}
	}
	for _, z := range b {
		if !seen[z] {
			seen[z] = true
			out = append(out, z)
		}
	}
	return out
}

func filterListingsByZips(listings []Listing, zips []string) []Listing {
	if len(zips) == 0 {
		return listings
	}
	want := map[string]bool{}
	for _, z := range zips {
		want[z] = true
	}
	out := make([]Listing, 0, len(listings))
	for i := range listings {
		if want[strings.TrimSpace(listings[i].ZipCode)] {
			out = append(out, listings[i])
		}
	}
	return out
}

func joinNotes(base string, notes []string) string {
	if len(notes) == 0 {
		return base
	}
	if base == "" {
		return strings.Join(notes, " ")
	}
	return base + " " + strings.Join(notes, " ")
}
