package serpapi

import (
	"errors"
	"fmt"
	"strings"
	"unicode"
)

// Partner / alliance presets expanded into SerpAPI include_airlines values.
var airlinePresets = map[string]string{
	"alaska_partners": "AS,ONEWORLD",
	"alaska":          "AS,ONEWORLD",
	"delta_partners":  "DL,SKYTEAM",
	"delta":           "DL,SKYTEAM",
}

var knownAlliances = map[string]struct{}{
	"STAR_ALLIANCE": {},
	"SKYTEAM":       {},
	"ONEWORLD":      {},
}

// US-flag marketing carriers (IATA). Used for Fly America *hints* only — not legal advice.
var usFlagCarriers = map[string]struct{}{
	"AA": {}, "AS": {}, "B6": {}, "DL": {}, "F9": {}, "G4": {},
	"HA": {}, "MX": {}, "NK": {}, "SY": {}, "UA": {}, "WN": {},
	"YX": {}, "OO": {}, "QX": {}, "CP": {}, "9E": {}, "OH": {},
	"MQ": {}, "PT": {}, "ZW": {}, "C5": {}, "G7": {},
}

// Common airline display names → IATA when flight_number is missing.
var airlineNameToIATA = map[string]string{
	"alaska airlines": "AS", "alaska": "AS",
	"american airlines": "AA", "american": "AA",
	"delta air lines": "DL", "delta": "DL",
	"united airlines": "UA", "united": "UA",
	"jetblue": "B6", "jetblue airways": "B6",
	"southwest airlines": "WN", "southwest": "WN",
	"hawaiian airlines": "HA", "hawaiian": "HA",
	"frontier airlines": "F9", "frontier": "F9",
	"spirit airlines": "NK", "spirit": "NK",
	"allegiant air": "G4", "allegiant": "G4",
	"sun country airlines": "SY", "sun country": "SY",
	"breeze airways": "MX", "breeze": "MX",
	"british airways": "BA", "air france": "AF", "klm": "KL",
	"lufthansa": "LH", "ana": "NH", "all nippon airways": "NH",
	"japan airlines": "JL", "jal": "JL", "eva air": "BR",
	"china airlines": "CI", "korean air": "KE", "qatar airways": "QR",
	"emirates": "EK", "singapore airlines": "SQ", "cathay pacific": "CX",
	"air canada": "AC", "westjet": "WS",
}

// Airports commonly associated with Open Skies partner regions (EU/CH/AU/JP).
// Incomplete on purpose — hint only when we recognize the destination.
var openSkiesAirports = map[string]string{
	// Japan
	"HND": "JP", "NRT": "JP", "KIX": "JP", "ITM": "JP", "FUK": "JP", "NGO": "JP",
	// Australia
	"SYD": "AU", "MEL": "AU", "BNE": "AU", "PER": "AU", "ADL": "AU", "CBR": "AU",
	// Switzerland
	"ZRH": "CH", "GVA": "CH", "BSL": "CH",
	// EU (common)
	"CDG": "EU", "ORY": "EU", "LYS": "EU", "NCE": "EU", "MRS": "EU",
	"FRA": "EU", "MUC": "EU", "BER": "EU", "DUS": "EU", "HAM": "EU",
	"AMS": "EU", "BRU": "EU", "LUX": "EU",
	"MAD": "EU", "BCN": "EU", "LIS": "EU", "OPO": "EU",
	"FCO": "EU", "MXP": "EU", "LIN": "EU", "VCE": "EU",
	"ATH": "EU", "VIE": "EU", "PRG": "EU", "BUD": "EU", "WAW": "EU",
	"CPH": "EU", "ARN": "EU", "OSL": "EU", "HEL": "EU",
	"DUB": "EU", "KEF": "EU",
	"LHR": "EU", "LGW": "EU", "STN": "EU", "MAN": "EU", "EDI": "EU",
}

const (
	FlyAmericaOK      = "likely_fly_america_ok"
	FlyAmericaReview  = "needs_review"
	FlyAmericaForeign = "likely_foreign"

	RefundableYes     = "yes"
	RefundableNo      = "no"
	RefundableUnknown = "unknown"
)

// resolveAirlineList expands presets and validates IATA / alliance tokens.
// Returns a comma-separated SerpAPI value, or empty if none.
func resolveAirlineList(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, p := range parts {
		tok := strings.TrimSpace(p)
		if tok == "" {
			continue
		}
		key := strings.ToLower(tok)
		if preset, ok := airlinePresets[key]; ok {
			for e := range strings.SplitSeq(preset, ",") {
				e = strings.TrimSpace(e)
				if e == "" {
					continue
				}
				if _, ok := seen[e]; ok {
					continue
				}
				seen[e] = struct{}{}
				out = append(out, e)
			}
			continue
		}
		up := strings.ToUpper(tok)
		if _, ok := knownAlliances[up]; ok {
			if _, ok := seen[up]; !ok {
				seen[up] = struct{}{}
				out = append(out, up)
			}
			continue
		}
		if !validAirlineIATA(up) {
			return "", fmt.Errorf("invalid airline code %q (use 2-char IATA, STAR_ALLIANCE/SKYTEAM/ONEWORLD, or alaska_partners/delta_partners)", tok)
		}
		if _, ok := seen[up]; !ok {
			seen[up] = struct{}{}
			out = append(out, up)
		}
	}
	return strings.Join(out, ","), nil
}

func validAirlineIATA(code string) bool {
	if len(code) != 2 {
		return false
	}
	for _, r := range code {
		if unicode.IsUpper(r) || unicode.IsDigit(r) {
			continue
		}
		return false
	}
	// At least one letter (SerpAPI: two letters, or letter+digit).
	hasLetter := false
	for _, r := range code {
		if unicode.IsUpper(r) {
			hasLetter = true
			break
		}
	}
	return hasLetter
}

func applyAirlineParams(include, exclude string) (inc, exc string, err error) {
	inc, err = resolveAirlineList(include)
	if err != nil {
		return "", "", err
	}
	exc, err = resolveAirlineList(exclude)
	if err != nil {
		return "", "", err
	}
	if inc != "" && exc != "" {
		return "", "", errors.New("include_airlines and exclude_airlines cannot be used together")
	}
	return inc, exc, nil
}

func marketingCodeFromFlightNumber(fn string) string {
	fn = strings.ToUpper(strings.TrimSpace(fn))
	if fn == "" {
		return ""
	}
	// "AS 123", "AS123", "B6101", "9E4800"
	var code []rune
	for i, r := range fn {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			code = append(code, r)
			if len(code) == 2 {
				// Need a digit soon after to confirm it's a flight number prefix.
				rest := strings.TrimSpace(fn[i+1:])
				if rest == "" {
					return ""
				}
				for _, rr := range rest {
					if unicode.IsDigit(rr) {
						return string(code)
					}
					if unicode.IsSpace(rr) {
						continue
					}
					break
				}
				return ""
			}
			continue
		}
		if unicode.IsSpace(r) && len(code) > 0 {
			continue
		}
		break
	}
	return ""
}

func marketingCodeFromAirlineName(name string) string {
	key := strings.ToLower(strings.TrimSpace(name))
	if key == "" {
		return ""
	}
	if code, ok := airlineNameToIATA[key]; ok {
		return code
	}
	return ""
}

func segmentMarketingCode(seg FlightSegment) string {
	if c := marketingCodeFromFlightNumber(seg.FlightNumber); c != "" {
		return c
	}
	return marketingCodeFromAirlineName(seg.Airline)
}

func classifyFlyAmerica(o FlightOffer) (status, note string, codes []string) {
	seen := map[string]struct{}{}
	var us, foreign, unknown int
	for i := range o.Flights {
		code := segmentMarketingCode(o.Flights[i])
		if code == "" {
			unknown++
			continue
		}
		if _, ok := seen[code]; !ok {
			seen[code] = struct{}{}
			codes = append(codes, code)
		}
		if _, ok := usFlagCarriers[code]; ok {
			us++
		} else {
			foreign++
		}
	}
	note = "Based on marketing flight designators only (codeshare metal may differ). " +
		"Not legal certification — confirm the ticket shows a US carrier designator when required."
	switch {
	case len(o.Flights) == 0 || (us == 0 && foreign == 0):
		return FlyAmericaReview, note + " Could not determine marketing carriers.", codes
	case foreign == 0 && unknown == 0:
		return FlyAmericaOK, note, codes
	case us == 0 && foreign > 0 && unknown == 0:
		return FlyAmericaForeign, note + " One or more segments appear ticketed under a foreign designator.", codes
	case foreign > 0:
		return FlyAmericaForeign, note + " Mix includes a foreign marketing designator.", codes
	default:
		return FlyAmericaReview, note + " Incomplete marketing codes on some segments.", codes
	}
}

func applyFlyAmerica(out *OfferSearchResult, mode, funding string) error {
	mode = strings.ToLower(strings.TrimSpace(mode))
	funding = strings.ToLower(strings.TrimSpace(funding))
	if mode == "" || mode == "off" || mode == "none" {
		return nil
	}
	if mode != "annotate" && mode != "filter" {
		return errors.New("fly_america must be annotate, filter, or empty")
	}
	if funding == "" {
		funding = "civilian"
	}
	if funding != "civilian" && funding != "dod" {
		return errors.New("funding must be civilian or dod")
	}

	kept := make([]FlightOffer, 0, len(out.Offers))
	for i := range out.Offers {
		o := out.Offers[i]
		status, note, codes := classifyFlyAmerica(o)
		o.FlyAmericaStatus = status
		o.FlyAmericaNote = note
		o.MarketingCodes = codes
		if mode == "filter" && status == FlyAmericaForeign {
			continue
		}
		kept = append(kept, o)
	}
	out.Offers = kept
	out.ComplianceNote = "fly_america=" + mode + " is a heuristic hint only — not legal advice or certification. " +
		"Confirm the purchased ticket shows a US-flag carrier designator (or a documented exception)."
	if region, ok := openSkiesAirports[strings.ToUpper(out.Destination)]; ok && funding == "civilian" {
		out.OpenSkiesHint = fmt.Sprintf(
			"Destination %s looks like Open Skies region (%s). Civilian-funded travel may have Open Skies exceptions; DoD-funded travel typically cannot use them. Verify current GSA/agency rules.",
			out.Destination, region,
		)
	} else if funding == "dod" {
		out.OpenSkiesHint = "funding=dod: Open Skies exceptions typically do not apply — prefer US-flag marketing designators."
	}
	return nil
}

func detectRefundable(title string, extensions []string) string {
	blob := strings.ToLower(strings.TrimSpace(title + " " + strings.Join(extensions, " ")))
	if blob == "" {
		return RefundableUnknown
	}
	switch {
	case strings.Contains(blob, "no refund"),
		strings.Contains(blob, "non-refundable"),
		strings.Contains(blob, "nonrefundable"),
		strings.Contains(blob, "non refundable"):
		return RefundableNo
	case strings.Contains(blob, "refundable"),
		strings.Contains(blob, "full refund"),
		strings.Contains(blob, "refunds allowed"):
		return RefundableYes
	default:
		return RefundableUnknown
	}
}

func filterRefundableOptions(opts []BookingOption, only bool) []BookingOption {
	if !only {
		return opts
	}
	out := make([]BookingOption, 0, len(opts))
	for i := range opts {
		if opts[i].Refundable == RefundableNo {
			continue
		}
		out = append(out, opts[i])
	}
	return out
}
