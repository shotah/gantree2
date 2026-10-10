package serpapi

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// TripType values for SerpAPI google_flights `type`.
const (
	TripRoundTrip = 1
	TripOneWay    = 2
)

// TravelClass values for SerpAPI google_flights `travel_class`.
const (
	ClassEconomy        = 1
	ClassPremiumEconomy = 2
	ClassBusiness       = 3
	ClassFirst          = 4
)

// Stops filter values.
const (
	StopsAny        = 0
	StopsNonstop    = 1
	StopsOneOrFewer = 2
	StopsTwoOrFewer = 3
)

// SortBy values.
const (
	SortTop      = 1
	SortPrice    = 2
	SortDuration = 5
)

// OfferSearchRequest is a lean flight search.
type OfferSearchRequest struct {
	Origin          string // IATA or kgmid (/m/…)
	Destination     string
	OutboundDate    string // YYYY-MM-DD
	ReturnDate      string // optional; empty ⇒ one-way
	Adults          int
	TravelClass     string // economy | premium_economy | business | first
	Stops           string // any | nonstop | 1_or_fewer | 2_or_fewer
	SortBy          string // top | price | duration
	Currency        string
	Country         string // gl, e.g. us
	Language        string // hl, e.g. en
	MaxPrice        int
	DeepSearch      bool
	MaxResults      int
	IncludeAirlines string // IATA / alliances / alaska_partners|delta_partners
	ExcludeAirlines string // mutually exclusive with IncludeAirlines
	ExcludeBasic    bool   // SerpAPI: US domestic + economy only; ≠ refundable
	FlyAmerica      string // empty | annotate | filter
	Funding         string // civilian (default) | dod — Open Skies hint only
}

// FlightOffer is a normalized itinerary for the agent.
type FlightOffer struct {
	Price            float64         `json:"price"`
	Currency         string          `json:"currency,omitempty"`
	TotalDurationMin int             `json:"total_duration_min,omitempty"`
	Stops            int             `json:"stops"`
	Airlines         []string        `json:"airlines,omitempty"`
	MarketingCodes   []string        `json:"marketing_codes,omitempty"`
	DepartureAirport string          `json:"departure_airport,omitempty"`
	ArrivalAirport   string          `json:"arrival_airport,omitempty"`
	DepartureTime    string          `json:"departure_time,omitempty"`
	ArrivalTime      string          `json:"arrival_time,omitempty"`
	Layovers         []string        `json:"layovers,omitempty"`
	Flights          []FlightSegment `json:"flights,omitempty"`
	CarbonEmissions  *CarbonInfo     `json:"carbon_emissions,omitempty"`
	Summary          string          `json:"summary,omitempty"`
	DepartureToken   string          `json:"departure_token,omitempty"`
	BookingToken     string          `json:"booking_token,omitempty"`
	FlyAmericaStatus string          `json:"fly_america_status,omitempty"` // likely_fly_america_ok | needs_review | likely_foreign
	FlyAmericaNote   string          `json:"fly_america_note,omitempty"`
}

// FlightSegment is one leg.
type FlightSegment struct {
	Airline       string `json:"airline,omitempty"`
	FlightNumber  string `json:"flight_number,omitempty"`
	Airplane      string `json:"airplane,omitempty"`
	TravelClass   string `json:"travel_class,omitempty"`
	DepartureID   string `json:"departure_airport,omitempty"`
	ArrivalID     string `json:"arrival_airport,omitempty"`
	DepartureTime string `json:"departure_time,omitempty"`
	ArrivalTime   string `json:"arrival_time,omitempty"`
	DurationMin   int    `json:"duration_min,omitempty"`
}

// CarbonInfo is optional emissions metadata from Google Flights.
type CarbonInfo struct {
	ThisFlight        int     `json:"this_flight,omitempty"`
	TypicalForRoute   int     `json:"typical_for_route,omitempty"`
	DifferencePercent float64 `json:"difference_percent,omitempty"`
}

// PriceHistoryPoint is one (unix seconds, price) sample from Google Flights.
type PriceHistoryPoint struct {
	Timestamp int64   `json:"timestamp"`
	Price     float64 `json:"price"`
}

// PriceInsights summarizes Google’s fare assessment.
type PriceInsights struct {
	LowestPrice      float64             `json:"lowest_price,omitempty"`
	PriceLevel       string              `json:"price_level,omitempty"`
	TypicalPriceLow  float64             `json:"typical_price_low,omitempty"`
	TypicalPriceHigh float64             `json:"typical_price_high,omitempty"`
	PriceHistory     []PriceHistoryPoint `json:"price_history,omitempty"`
}

// OfferSearchResult is the tool-facing search payload.
type OfferSearchResult struct {
	TripType         string         `json:"trip_type"`
	Origin           string         `json:"origin"`
	Destination      string         `json:"destination"`
	OutboundDate     string         `json:"outbound_date"`
	ReturnDate       string         `json:"return_date,omitempty"`
	Currency         string         `json:"currency"`
	GoogleFlightsURL string         `json:"google_flights_url,omitempty"`
	PriceInsights    *PriceInsights `json:"price_insights,omitempty"`
	Offers           []FlightOffer  `json:"offers"`
	Recommendation   string         `json:"recommendation,omitempty"`
	ComplianceNote   string         `json:"compliance_note,omitempty"`
	OpenSkiesHint    string         `json:"open_skies_hint,omitempty"`
	Usage            *Usage         `json:"usage,omitempty"`
}

// DatesSearchRequest samples prices across a departure window.
// When StayNights > 0, each sample is a round-trip (return = outbound + stay_nights).
// StayNightsMin/Max (inclusive) spread samples across a stay-length range (e.g. 4–7)
// within the same max_samples budget — for “cheap 4–7 day trip” scans.
type DatesSearchRequest struct {
	Origin          string
	Destination     string
	StartDate       string // YYYY-MM-DD window start
	EndDate         string // YYYY-MM-DD window end
	StayNights      int    // 0 = one-way; >0 = fixed round-trip stay
	StayNightsMin   int    // optional; with StayNightsMax spreads stay lengths
	StayNightsMax   int    // optional; inclusive
	Currency        string
	Stops           string
	TravelClass     string
	MaxSamples      int // default 5, hard max 7
	IncludeAirlines string
	ExcludeAirlines string
}

// DatePrice is one sampled day for flexible-date search.
type DatePrice struct {
	OutboundDate string  `json:"outbound_date"`
	ReturnDate   string  `json:"return_date,omitempty"`
	LowestPrice  float64 `json:"lowest_price,omitempty"`
	Currency     string  `json:"currency,omitempty"`
	Airline      string  `json:"airline,omitempty"`
	Stops        int     `json:"stops"`
	DurationMin  int     `json:"duration_min,omitempty"`
	Summary      string  `json:"summary,omitempty"`
	Error        string  `json:"error,omitempty"`
}

// DatesSearchResult ranks sampled departure dates by price.
type DatesSearchResult struct {
	TripType       string      `json:"trip_type"`
	Origin         string      `json:"origin"`
	Destination    string      `json:"destination"`
	StartDate      string      `json:"start_date"`
	EndDate        string      `json:"end_date"`
	StayNights     int         `json:"stay_nights,omitempty"`
	Currency       string      `json:"currency"`
	Samples        []DatePrice `json:"samples"`
	CheapestDate   string      `json:"cheapest_date,omitempty"`
	CheapestReturn string      `json:"cheapest_return,omitempty"`
	CheapestPrice  float64     `json:"cheapest_price,omitempty"`
	Recommendation string      `json:"recommendation,omitempty"`
	Usage          *Usage      `json:"usage,omitempty"`
}

// AirportHit is one airport or city suggestion.
type AirportHit struct {
	Name        string         `json:"name"`
	Type        string         `json:"type,omitempty"`
	ID          string         `json:"id,omitempty"`
	Description string         `json:"description,omitempty"`
	Airports    []AirportBrief `json:"airports,omitempty"`
}

// AirportBrief is a nested airport under a city suggestion.
type AirportBrief struct {
	Name     string `json:"name"`
	ID       string `json:"id"`
	City     string `json:"city,omitempty"`
	Distance string `json:"distance,omitempty"`
}

// AirportsSearchResult wraps autocomplete suggestions.
type AirportsSearchResult struct {
	Query       string       `json:"query"`
	Suggestions []AirportHit `json:"suggestions"`
	Usage       *Usage       `json:"usage,omitempty"`
}

type rawFlightsResponse struct {
	SearchMetadata struct {
		GoogleFlightsURL string `json:"google_flights_url"`
	} `json:"search_metadata"`
	SearchParameters struct {
		Currency string `json:"currency"`
	} `json:"search_parameters"`
	BestFlights   []rawOffer `json:"best_flights"`
	OtherFlights  []rawOffer `json:"other_flights"`
	PriceInsights *struct {
		LowestPrice       float64     `json:"lowest_price"`
		PriceLevel        string      `json:"price_level"`
		TypicalPriceRange []float64   `json:"typical_price_range"`
		PriceHistory      [][]float64 `json:"price_history"`
	} `json:"price_insights"`
}

type rawOffer struct {
	Flights []struct {
		DepartureAirport struct {
			Name string `json:"name"`
			ID   string `json:"id"`
			Time string `json:"time"`
		} `json:"departure_airport"`
		ArrivalAirport struct {
			Name string `json:"name"`
			ID   string `json:"id"`
			Time string `json:"time"`
		} `json:"arrival_airport"`
		Duration     int    `json:"duration"`
		Airplane     string `json:"airplane"`
		Airline      string `json:"airline"`
		AirlineLogo  string `json:"airline_logo"`
		TravelClass  string `json:"travel_class"`
		FlightNumber string `json:"flight_number"`
	} `json:"flights"`
	Layovers []struct {
		Duration int    `json:"duration"`
		Name     string `json:"name"`
		ID       string `json:"id"`
	} `json:"layovers"`
	TotalDuration   int `json:"total_duration"`
	CarbonEmissions *struct {
		ThisFlight          int     `json:"this_flight"`
		TypicalForThisRoute int     `json:"typical_for_this_route"`
		DifferencePercent   float64 `json:"difference_percent"`
	} `json:"carbon_emissions"`
	Price          float64 `json:"price"`
	Type           string  `json:"type"`
	AirlineLogo    string  `json:"airline_logo"`
	DepartureToken string  `json:"departure_token"`
	BookingToken   string  `json:"booking_token"`
}

type rawAutocompleteResponse struct {
	Suggestions []struct {
		Position    int    `json:"position"`
		Name        string `json:"name"`
		Type        string `json:"type"`
		Description string `json:"description"`
		ID          string `json:"id"`
		Airports    []struct {
			Name     string `json:"name"`
			ID       string `json:"id"`
			City     string `json:"city"`
			Distance string `json:"distance"`
		} `json:"airports"`
	} `json:"suggestions"`
}

// SearchOffers queries Google Flights via SerpAPI and normalizes offers.
// Attaches a SerpAPI usage snapshot after the search (account API is free).
func (c *Client) SearchOffers(ctx context.Context, req OfferSearchRequest) (*OfferSearchResult, error) {
	out, err := c.searchOffers(ctx, req)
	if err != nil {
		return nil, err
	}
	out.Usage = c.usageOrNil(ctx)
	return out, nil
}

// searchOffers is the core flight search without an account usage round-trip
// (used by SearchDates so a multi-sample scan only checks quota once at the end).
func (c *Client) searchOffers(ctx context.Context, req OfferSearchRequest) (*OfferSearchResult, error) {
	if err := validateOfferRequest(req); err != nil {
		return nil, err
	}
	params, err := offerParams(req)
	if err != nil {
		return nil, err
	}
	var raw rawFlightsResponse
	if err := c.GetJSON(ctx, params, &raw); err != nil {
		return nil, err
	}

	currency := req.Currency
	if currency == "" {
		currency = raw.SearchParameters.Currency
	}
	if currency == "" {
		currency = "USD"
	}

	merged := append([]rawOffer{}, raw.BestFlights...)
	merged = append(merged, raw.OtherFlights...)
	maxResults := req.MaxResults
	if maxResults <= 0 {
		maxResults = 10
	}
	offers := make([]FlightOffer, 0, min(len(merged), maxResults))
	for i := range merged {
		if i >= maxResults {
			break
		}
		offers = append(offers, normalizeOffer(merged[i], currency))
	}

	trip := "one_way"
	if strings.TrimSpace(req.ReturnDate) != "" {
		trip = "round_trip"
	}
	out := &OfferSearchResult{
		TripType:         trip,
		Origin:           strings.ToUpper(strings.TrimSpace(req.Origin)),
		Destination:      strings.ToUpper(strings.TrimSpace(req.Destination)),
		OutboundDate:     req.OutboundDate,
		ReturnDate:       req.ReturnDate,
		Currency:         currency,
		GoogleFlightsURL: raw.SearchMetadata.GoogleFlightsURL,
		Offers:           offers,
	}
	if out.GoogleFlightsURL == "" {
		out.GoogleFlightsURL = BuildGoogleFlightsURL(LinkParams{
			Origin:       req.Origin,
			Destination:  req.Destination,
			OutboundDate: req.OutboundDate,
			ReturnDate:   req.ReturnDate,
			Currency:     currency,
			Country:      req.Country,
			Language:     req.Language,
		})
	}
	if raw.PriceInsights != nil {
		pi := &PriceInsights{
			LowestPrice: raw.PriceInsights.LowestPrice,
			PriceLevel:  raw.PriceInsights.PriceLevel,
		}
		if len(raw.PriceInsights.TypicalPriceRange) >= 2 {
			pi.TypicalPriceLow = raw.PriceInsights.TypicalPriceRange[0]
			pi.TypicalPriceHigh = raw.PriceInsights.TypicalPriceRange[1]
		}
		pi.PriceHistory = normalizePriceHistory(raw.PriceInsights.PriceHistory)
		out.PriceInsights = pi
	}
	if err := applyFlyAmerica(out, req.FlyAmerica, req.Funding); err != nil {
		return nil, err
	}
	out.Recommendation = recommendOffers(out)
	return out, nil
}

func normalizePriceHistory(raw [][]float64) []PriceHistoryPoint {
	if len(raw) == 0 {
		return nil
	}
	out := make([]PriceHistoryPoint, 0, len(raw))
	for _, pair := range raw {
		if len(pair) < 2 {
			continue
		}
		out = append(out, PriceHistoryPoint{
			Timestamp: int64(pair[0]),
			Price:     pair[1],
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// SearchDates samples prices across a departure date window (inclusive).
// maxSamples caps SerpAPI spend (default 5, hard max 7).
// StayNights > 0 requests round-trip samples (return = outbound + stay_nights).
func (c *Client) SearchDates(ctx context.Context, req DatesSearchRequest) (*DatesSearchResult, error) {
	origin := strings.TrimSpace(req.Origin)
	destination := strings.TrimSpace(req.Destination)
	if origin == "" || destination == "" {
		return nil, errors.New("origin and destination are required")
	}
	start, err := time.Parse("2006-01-02", req.StartDate)
	if err != nil {
		return nil, errors.New("start_date must be YYYY-MM-DD")
	}
	end, err := time.Parse("2006-01-02", req.EndDate)
	if err != nil {
		return nil, errors.New("end_date must be YYYY-MM-DD")
	}
	if end.Before(start) {
		return nil, errors.New("end_date must be on or after start_date")
	}
	if req.StayNights < 0 {
		return nil, errors.New("stay_nights must be >= 0")
	}
	stayMin, stayMax, err := resolveStayRange(req.StayNights, req.StayNightsMin, req.StayNightsMax)
	if err != nil {
		return nil, err
	}
	maxSamples := req.MaxSamples
	if maxSamples <= 0 {
		maxSamples = 5
	}
	if maxSamples > 7 {
		maxSamples = 7
	}
	currency := req.Currency
	if currency == "" {
		currency = "USD"
	}
	travelClass := req.TravelClass
	if travelClass == "" {
		travelClass = "economy"
	}

	trip := "one_way"
	if stayMax > 0 {
		trip = "round_trip"
	}

	plans := sampleDateStayPlans(start, end, stayMin, stayMax, maxSamples)
	out := &DatesSearchResult{
		TripType:    trip,
		Origin:      strings.ToUpper(origin),
		Destination: strings.ToUpper(destination),
		StartDate:   req.StartDate,
		EndDate:     req.EndDate,
		StayNights:  req.StayNights,
		Currency:    currency,
		Samples:     make([]DatePrice, 0, len(plans)),
	}

	var best *DatePrice
	for _, plan := range plans {
		day := plan.Outbound.Format("2006-01-02")
		sample := DatePrice{OutboundDate: day, Currency: currency}
		offerReq := OfferSearchRequest{
			Origin:          origin,
			Destination:     destination,
			OutboundDate:    day,
			Adults:          1,
			TravelClass:     travelClass,
			Stops:           req.Stops,
			SortBy:          "price",
			Currency:        currency,
			MaxResults:      1,
			IncludeAirlines: req.IncludeAirlines,
			ExcludeAirlines: req.ExcludeAirlines,
		}
		if plan.StayNights > 0 {
			ret := plan.Outbound.AddDate(0, 0, plan.StayNights).Format("2006-01-02")
			sample.ReturnDate = ret
			offerReq.ReturnDate = ret
		}
		res, err := c.searchOffers(ctx, offerReq)
		if err != nil {
			sample.Error = err.Error()
			out.Samples = append(out.Samples, sample)
			continue
		}
		if len(res.Offers) == 0 {
			sample.Error = "no offers"
			out.Samples = append(out.Samples, sample)
			continue
		}
		o := res.Offers[0]
		sample.LowestPrice = o.Price
		sample.Stops = o.Stops
		sample.DurationMin = o.TotalDurationMin
		sample.Summary = o.Summary
		if len(o.Airlines) > 0 {
			sample.Airline = o.Airlines[0]
		}
		out.Samples = append(out.Samples, sample)
		if best == nil || (sample.LowestPrice > 0 && sample.LowestPrice < best.LowestPrice) {
			cp := sample
			best = &cp
		}
	}
	out.Recommendation = recommendDates(out, best, len(plans))
	if best != nil && best.LowestPrice > 0 {
		out.CheapestDate = best.OutboundDate
		out.CheapestReturn = best.ReturnDate
		out.CheapestPrice = best.LowestPrice
	}
	out.Usage = c.usageOrNil(ctx)
	return out, nil
}

func resolveStayRange(fixed, minN, maxN int) (int, int, error) {
	if minN == 0 && maxN == 0 {
		return fixed, fixed, nil
	}
	if minN < 0 || maxN < 0 {
		return 0, 0, errors.New("stay_nights_min/max must be >= 0")
	}
	if minN > 0 && maxN == 0 {
		maxN = minN
	}
	if maxN > 0 && minN == 0 {
		minN = maxN
	}
	if maxN < minN {
		return 0, 0, errors.New("stay_nights_max must be >= stay_nights_min")
	}
	if fixed > 0 {
		// Explicit stay_nights wins over a range.
		return fixed, fixed, nil
	}
	return minN, maxN, nil
}

type dateStayPlan struct {
	Outbound   time.Time
	StayNights int
}

// sampleDateStayPlans spreads up to n SerpAPI samples across outbound dates and
// optional stay-length range (for “4–7 night” scans without N×M explosion).
func sampleDateStayPlans(start, end time.Time, stayMin, stayMax, n int) []dateStayPlan {
	if stayMax <= 0 {
		dates := sampleDates(start, end, n)
		out := make([]dateStayPlan, 0, len(dates))
		for _, d := range dates {
			out = append(out, dateStayPlan{Outbound: d, StayNights: 0})
		}
		return out
	}
	if stayMin <= 0 {
		stayMin = stayMax
	}
	stays := max(stayMax-stayMin+1, 1)
	dates := sampleDates(start, end, n)
	if len(dates) == 0 {
		return nil
	}
	out := make([]dateStayPlan, 0, n)
	for i := range n {
		out = append(out, dateStayPlan{
			Outbound:   dates[i%len(dates)],
			StayNights: stayMin + (i % stays),
		})
	}
	return out
}

// SearchAirports resolves a city/airport query via Google Flights autocomplete.
func (c *Client) SearchAirports(ctx context.Context, query, country, language string) (*AirportsSearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, errors.New("query is required")
	}
	if country == "" {
		country = "us"
	}
	if language == "" {
		language = "en"
	}
	params := url.Values{}
	params.Set("engine", "google_flights_autocomplete")
	params.Set("q", query)
	params.Set("gl", country)
	params.Set("hl", language)

	var raw rawAutocompleteResponse
	if err := c.GetJSON(ctx, params, &raw); err != nil {
		return nil, err
	}
	out := &AirportsSearchResult{Query: query, Suggestions: make([]AirportHit, 0, len(raw.Suggestions))}
	for _, s := range raw.Suggestions {
		hit := AirportHit{
			Name:        s.Name,
			Type:        s.Type,
			ID:          s.ID,
			Description: s.Description,
		}
		for _, a := range s.Airports {
			hit.Airports = append(hit.Airports, AirportBrief{
				Name: a.Name, ID: a.ID, City: a.City, Distance: a.Distance,
			})
		}
		out.Suggestions = append(out.Suggestions, hit)
	}
	out.Usage = c.usageOrNil(ctx)
	return out, nil
}

func validateOfferRequest(req OfferSearchRequest) error {
	if strings.TrimSpace(req.Origin) == "" || strings.TrimSpace(req.Destination) == "" {
		return errors.New("origin and destination are required (IATA codes or Google location ids)")
	}
	if _, err := time.Parse("2006-01-02", req.OutboundDate); err != nil {
		return errors.New("outbound_date must be YYYY-MM-DD")
	}
	if rd := strings.TrimSpace(req.ReturnDate); rd != "" {
		if _, err := time.Parse("2006-01-02", rd); err != nil {
			return errors.New("return_date must be YYYY-MM-DD")
		}
	}
	return nil
}

func offerParams(req OfferSearchRequest) (url.Values, error) {
	params := url.Values{}
	params.Set("engine", "google_flights")
	params.Set("departure_id", strings.TrimSpace(req.Origin))
	params.Set("arrival_id", strings.TrimSpace(req.Destination))
	params.Set("outbound_date", req.OutboundDate)

	tripType := TripOneWay
	if strings.TrimSpace(req.ReturnDate) != "" {
		tripType = TripRoundTrip
		params.Set("return_date", req.ReturnDate)
	}
	params.Set("type", strconv.Itoa(tripType))

	adults := req.Adults
	if adults <= 0 {
		adults = 1
	}
	params.Set("adults", strconv.Itoa(adults))

	tc, err := parseTravelClass(req.TravelClass)
	if err != nil {
		return nil, err
	}
	params.Set("travel_class", strconv.Itoa(tc))

	stops, err := parseStops(req.Stops)
	if err != nil {
		return nil, err
	}
	if stops != StopsAny {
		params.Set("stops", strconv.Itoa(stops))
	}

	sortBy, err := parseSort(req.SortBy)
	if err != nil {
		return nil, err
	}
	params.Set("sort_by", strconv.Itoa(sortBy))

	currency := req.Currency
	if currency == "" {
		currency = "USD"
	}
	params.Set("currency", currency)

	gl := req.Country
	if gl == "" {
		gl = "us"
	}
	params.Set("gl", gl)

	hl := req.Language
	if hl == "" {
		hl = "en"
	}
	params.Set("hl", hl)

	if req.MaxPrice > 0 {
		params.Set("max_price", strconv.Itoa(req.MaxPrice))
	}
	if req.DeepSearch {
		params.Set("deep_search", "true")
	}
	inc, exc, err := applyAirlineParams(req.IncludeAirlines, req.ExcludeAirlines)
	if err != nil {
		return nil, err
	}
	if inc != "" {
		params.Set("include_airlines", inc)
	}
	if exc != "" {
		params.Set("exclude_airlines", exc)
	}
	if req.ExcludeBasic {
		params.Set("exclude_basic", "true")
	}
	return params, nil
}

func parseTravelClass(s string) (int, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "economy":
		return ClassEconomy, nil
	case "premium_economy", "premium-economy", "premium":
		return ClassPremiumEconomy, nil
	case "business":
		return ClassBusiness, nil
	case "first":
		return ClassFirst, nil
	default:
		return 0, errors.New("travel_class must be economy, premium_economy, business, or first")
	}
}

func parseStops(s string) (int, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "any":
		return StopsAny, nil
	case "nonstop", "non-stop", "0":
		return StopsNonstop, nil
	case "1_or_fewer", "1", "one_or_fewer":
		return StopsOneOrFewer, nil
	case "2_or_fewer", "2", "two_or_fewer":
		return StopsTwoOrFewer, nil
	default:
		return 0, errors.New("stops must be any, nonstop, 1_or_fewer, or 2_or_fewer")
	}
}

func parseSort(s string) (int, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "top":
		return SortTop, nil
	case "price":
		return SortPrice, nil
	case "duration":
		return SortDuration, nil
	default:
		return 0, errors.New("sort_by must be top, price, or duration")
	}
}

func normalizeOffer(o rawOffer, currency string) FlightOffer {
	out := FlightOffer{
		Price:            o.Price,
		Currency:         currency,
		TotalDurationMin: o.TotalDuration,
		DepartureToken:   o.DepartureToken,
		BookingToken:     o.BookingToken,
	}
	seenAirline := map[string]struct{}{}
	for i := range o.Flights {
		f := &o.Flights[i]
		seg := FlightSegment{
			Airline:       f.Airline,
			FlightNumber:  f.FlightNumber,
			Airplane:      f.Airplane,
			TravelClass:   f.TravelClass,
			DepartureID:   f.DepartureAirport.ID,
			ArrivalID:     f.ArrivalAirport.ID,
			DepartureTime: f.DepartureAirport.Time,
			ArrivalTime:   f.ArrivalAirport.Time,
			DurationMin:   f.Duration,
		}
		out.Flights = append(out.Flights, seg)
		if f.Airline != "" {
			if _, ok := seenAirline[f.Airline]; !ok {
				seenAirline[f.Airline] = struct{}{}
				out.Airlines = append(out.Airlines, f.Airline)
			}
		}
		if i == 0 {
			out.DepartureAirport = f.DepartureAirport.ID
			out.DepartureTime = f.DepartureAirport.Time
		}
		if i == len(o.Flights)-1 {
			out.ArrivalAirport = f.ArrivalAirport.ID
			out.ArrivalTime = f.ArrivalAirport.Time
		}
	}
	out.Stops = max(0, len(o.Flights)-1)
	for _, l := range o.Layovers {
		label := l.ID
		if label == "" {
			label = l.Name
		}
		if l.Duration > 0 {
			label = fmt.Sprintf("%s (%dm)", label, l.Duration)
		}
		out.Layovers = append(out.Layovers, label)
	}
	if o.CarbonEmissions != nil {
		out.CarbonEmissions = &CarbonInfo{
			ThisFlight:        o.CarbonEmissions.ThisFlight,
			TypicalForRoute:   o.CarbonEmissions.TypicalForThisRoute,
			DifferencePercent: o.CarbonEmissions.DifferencePercent,
		}
	}
	out.Summary = summarizeOffer(out)
	return out
}

func summarizeOffer(o FlightOffer) string {
	airline := "unknown"
	if len(o.Airlines) > 0 {
		airline = strings.Join(o.Airlines, "/")
	}
	stops := "nonstop"
	switch {
	case o.Stops == 1:
		stops = "1 stop"
	case o.Stops > 1:
		stops = fmt.Sprintf("%d stops", o.Stops)
	}
	parts := []string{
		fmt.Sprintf("%.0f %s", o.Price, o.Currency),
		airline,
		stops,
	}
	if o.TotalDurationMin > 0 {
		parts = append(parts, formatDuration(o.TotalDurationMin))
	}
	route := strings.TrimSpace(o.DepartureAirport + " → " + o.ArrivalAirport)
	if o.DepartureTime != "" || o.ArrivalTime != "" {
		route = fmt.Sprintf("%s %s → %s %s",
			o.DepartureAirport, o.DepartureTime, o.ArrivalAirport, o.ArrivalTime)
	}
	if strings.TrimSpace(route) != "→" && route != "" {
		parts = append(parts, route)
	}
	if len(o.Layovers) > 0 {
		parts = append(parts, "layovers "+strings.Join(o.Layovers, ", "))
	}
	if o.CarbonEmissions != nil && o.CarbonEmissions.DifferencePercent != 0 {
		parts = append(parts, fmt.Sprintf("CO₂ %+.0f%% vs typical", o.CarbonEmissions.DifferencePercent))
	}
	return strings.Join(parts, " · ")
}

func formatDuration(mins int) string {
	if mins <= 0 {
		return ""
	}
	h := mins / 60
	m := mins % 60
	if h == 0 {
		return fmt.Sprintf("%dm", m)
	}
	if m == 0 {
		return fmt.Sprintf("%dh", h)
	}
	return fmt.Sprintf("%dh%dm", h, m)
}

func recommendOffers(res *OfferSearchResult) string {
	if len(res.Offers) == 0 {
		return "No flight offers returned for these dates. Try nearby airports (airports_search) or flexible dates (dates_search)."
	}
	best := res.Offers[0]
	bestIdx := 0
	for i := 1; i < len(res.Offers); i++ {
		o := &res.Offers[i]
		if o.Price > 0 && (best.Price == 0 || o.Price < best.Price) {
			best = *o
			bestIdx = i
		}
	}
	// Prefer a nonstop if it is within 15% of the cheapest fare.
	pick := best
	pickIdx := bestIdx
	if best.Stops > 0 {
		for i := range res.Offers {
			o := &res.Offers[i]
			if o.Stops != 0 || o.Price <= 0 {
				continue
			}
			if o.Price <= best.Price*1.15 && (pick.Stops > 0 || o.Price < pick.Price) {
				pick = *o
				pickIdx = i
			}
		}
	}

	msg := fmt.Sprintf("Recommend offer #%d: %s.", pickIdx+1, pick.Summary)
	if pickIdx != bestIdx {
		msg += fmt.Sprintf(" (cheapest is #%d at %.0f %s with %s)",
			bestIdx+1, best.Price, res.Currency, stopLabel(best.Stops))
	}
	if res.PriceInsights != nil && res.PriceInsights.PriceLevel != "" {
		msg += " Google price level: " + res.PriceInsights.PriceLevel
		if res.PriceInsights.TypicalPriceLow > 0 {
			msg += fmt.Sprintf(" (typical %.0f–%.0f %s)",
				res.PriceInsights.TypicalPriceLow, res.PriceInsights.TypicalPriceHigh, res.Currency)
		}
		msg += "."
		switch strings.ToLower(res.PriceInsights.PriceLevel) {
		case "low", "typically low":
			msg += " Fare looks favorable vs recent history."
		case "high", "typically high":
			msg += " Fare looks expensive — consider dates_search for cheaper days."
		}
		if n := len(res.PriceInsights.PriceHistory); n > 0 {
			msg += fmt.Sprintf(" price_history has %d samples.", n)
		}
	}
	msg += " For real checkout call booking_options_get with booking_token" +
		" (round-trip: returns_search with departure_token first)." +
		" Do not invent #flt= links; google_flights_url is a search fallback only."
	return msg
}

func stopLabel(stops int) string {
	switch stops {
	case 0:
		return "nonstop"
	case 1:
		return "1 stop"
	default:
		return fmt.Sprintf("%d stops", stops)
	}
}

func recommendDates(out *DatesSearchResult, best *DatePrice, sampleCount int) string {
	if best == nil || best.LowestPrice <= 0 {
		return "No priced samples in this window — widen dates or check airport codes via airports_search."
	}
	if out.StayNights > 0 {
		return fmt.Sprintf(
			"Cheapest sampled round-trip: depart %s, return %s (%d nights) at %.0f %s across %d samples. Confirm with offers_search before buying.",
			best.OutboundDate, best.ReturnDate, out.StayNights, best.LowestPrice, out.Currency, sampleCount,
		)
	}
	return fmt.Sprintf(
		"Cheapest sampled departure is %s at %.0f %s (%d sample days). Confirm with offers_search before buying.",
		best.OutboundDate, best.LowestPrice, out.Currency, sampleCount,
	)
}

func sampleDates(start, end time.Time, n int) []time.Time {
	days := max(int(end.Sub(start).Hours()/24)+1, 1)
	if n > days {
		n = days
	}
	out := make([]time.Time, 0, n)
	if n == 1 {
		return append(out, start)
	}
	for i := range n {
		offset := i * (days - 1) / (n - 1)
		out = append(out, start.AddDate(0, 0, offset))
	}
	return out
}
