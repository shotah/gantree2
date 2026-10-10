package serpapi

import (
	"fmt"
	"net/url"
	"strings"
)

// LinkParams builds a shareable Google Flights deep link (no SerpAPI call).
type LinkParams struct {
	Origin       string
	Destination  string
	OutboundDate string
	ReturnDate   string
	Currency     string
	Country      string
	Language     string
}

// BuildGoogleFlightsURL constructs a consumer Google Flights search URL.
// Uses the natural-language `q=` query form — the old `#flt=` hash deep links
// no longer prefill the search UI. Prefer booking_options_get for real checkout.
func BuildGoogleFlightsURL(p LinkParams) string {
	origin := strings.ToUpper(strings.TrimSpace(p.Origin))
	dest := strings.ToUpper(strings.TrimSpace(p.Destination))
	out := strings.TrimSpace(p.OutboundDate)
	ret := strings.TrimSpace(p.ReturnDate)

	hl := p.Language
	if hl == "" {
		hl = "en"
	}
	gl := p.Country
	if gl == "" {
		gl = "us"
	}
	curr := p.Currency
	if curr == "" {
		curr = "USD"
	}

	q := url.Values{}
	q.Set("hl", hl)
	q.Set("gl", gl)
	q.Set("curr", curr)

	// Natural language query still prefills Google Flights (as of 2026).
	// Example: "Flights from SEA to TPE on 2026-08-10 through 2026-08-16"
	query := fmt.Sprintf("Flights from %s to %s on %s", origin, dest, out)
	if ret != "" {
		query += " through " + ret
	}
	q.Set("q", query)

	return "https://www.google.com/travel/flights?" + q.Encode()
}
