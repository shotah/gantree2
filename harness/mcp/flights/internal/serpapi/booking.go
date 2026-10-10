package serpapi

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// BookingRequest is Google’s checkout handoff (often POST with post_data).
type BookingRequest struct {
	URL      string `json:"url"`
	PostData string `json:"post_data,omitempty"`
	Method   string `json:"method"` // GET when post_data empty; POST otherwise
	Note     string `json:"note,omitempty"`
}

// BookingOption is one airline/OTA fare the human can buy.
type BookingOption struct {
	BookWith      string          `json:"book_with,omitempty"`
	OptionTitle   string          `json:"option_title,omitempty"`
	Price         float64         `json:"price,omitempty"`
	Currency      string          `json:"currency,omitempty"`
	MarketedAs    []string        `json:"marketed_as,omitempty"`
	Extensions    []string        `json:"extensions,omitempty"`
	BaggagePrices []string        `json:"baggage_prices,omitempty"`
	IsAirline     bool            `json:"is_airline,omitempty"`
	TicketMode    string          `json:"ticket_mode,omitempty"` // together | departing | returning
	Refundable    string          `json:"refundable,omitempty"`  // yes | no | unknown
	Booking       *BookingRequest `json:"booking,omitempty"`
	Summary       string          `json:"summary,omitempty"`
}

// BookingOptionsRequest resolves a booking_token into checkout options.
type BookingOptionsRequest struct {
	BookingToken   string
	Currency       string
	Country        string
	Language       string
	RefundableOnly bool // drop options Google marks as non-refundable; keeps yes + unknown
}

// BookingOptionsResult is the tool-facing checkout payload.
type BookingOptionsResult struct {
	Options        []BookingOption `json:"options"`
	BaggagePrices  []string        `json:"baggage_prices,omitempty"`
	Recommendation string          `json:"recommendation,omitempty"`
	CheckoutNote   string          `json:"checkout_note"`
	Usage          *Usage          `json:"usage,omitempty"`
}

type rawBookingOptionsResponse struct {
	BookingOptions []rawBookingOptionWrap `json:"booking_options"`
	BaggagePrices  *struct {
		Together []string `json:"together"`
	} `json:"baggage_prices"`
	SearchParameters struct {
		Currency string `json:"currency"`
	} `json:"search_parameters"`
	Error string `json:"error"`
}

type rawBookingOptionWrap struct {
	Together  *rawBookingOptionDetail `json:"together"`
	Departing *rawBookingOptionDetail `json:"departing"`
	Returning *rawBookingOptionDetail `json:"returning"`
}

type rawBookingOptionDetail struct {
	BookWith      string   `json:"book_with"`
	Airline       bool     `json:"airline"`
	MarketedAs    []string `json:"marketed_as"`
	Price         float64  `json:"price"`
	OptionTitle   string   `json:"option_title"`
	Extensions    []string `json:"extensions"`
	BaggagePrices []string `json:"baggage_prices"`
	LocalPrices   []struct {
		Currency string  `json:"currency"`
		Price    float64 `json:"price"`
	} `json:"local_prices"`
	BookingRequest *struct {
		URL      string `json:"url"`
		PostData string `json:"post_data"`
	} `json:"booking_request"`
}

// GetBookingOptions resolves a booking_token into airline/OTA checkout options.
// This is the real buy path (not a Google Flights search URL).
func (c *Client) GetBookingOptions(ctx context.Context, req BookingOptionsRequest) (*BookingOptionsResult, error) {
	bookingToken := strings.TrimSpace(req.BookingToken)
	if bookingToken == "" {
		return nil, errors.New("booking_token is required (from offers_search or returns_search)")
	}
	currency := req.Currency
	if currency == "" {
		currency = "USD"
	}
	country := req.Country
	if country == "" {
		country = "us"
	}
	language := req.Language
	if language == "" {
		language = "en"
	}

	params := url.Values{}
	params.Set("engine", "google_flights")
	params.Set("booking_token", bookingToken)
	params.Set("currency", currency)
	params.Set("gl", country)
	params.Set("hl", language)

	var raw rawBookingOptionsResponse
	if err := c.GetJSON(ctx, params, &raw); err != nil {
		return nil, err
	}
	if raw.Error != "" {
		return nil, fmt.Errorf("serpapi: %s", raw.Error)
	}
	if cur := raw.SearchParameters.Currency; cur != "" {
		currency = cur
	}

	out := &BookingOptionsResult{
		Options: make([]BookingOption, 0, len(raw.BookingOptions)*2),
		CheckoutNote: "When booking.post_data is set, open booking.url with HTTP POST and send post_data unchanged as the body. " +
			"When post_data is empty, GET booking.url. This MCP does not purchase tickets. " +
			"refundable is parsed from Google option text only (yes/no/unknown) — never invent refundability.",
	}
	if raw.BaggagePrices != nil {
		out.BaggagePrices = raw.BaggagePrices.Together
	}

	for i := range raw.BookingOptions {
		w := &raw.BookingOptions[i]
		if w.Together != nil {
			out.Options = append(out.Options, normalizeBookingOption(w.Together, "together", currency))
		}
		if w.Departing != nil {
			out.Options = append(out.Options, normalizeBookingOption(w.Departing, "departing", currency))
		}
		if w.Returning != nil {
			out.Options = append(out.Options, normalizeBookingOption(w.Returning, "returning", currency))
		}
	}
	if len(out.Options) == 0 {
		return nil, errors.New("no booking options returned — token may be expired; re-run offers_search")
	}
	out.Options = filterRefundableOptions(out.Options, req.RefundableOnly)
	if len(out.Options) == 0 {
		return nil, errors.New("no booking options left after refundable_only — Google only showed non-refundable fares, or refundability was not labeled")
	}
	out.Recommendation = recommendBookingOptions(out.Options)
	out.Usage = c.usageOrNil(ctx)
	return out, nil
}

// SelectDeparture uses a departure_token from offers_search to load return-leg
// (or next-leg) offers that include booking_token values.
func (c *Client) SelectDeparture(ctx context.Context, departureToken, currency, country, language string) (*OfferSearchResult, error) {
	departureToken = strings.TrimSpace(departureToken)
	if departureToken == "" {
		return nil, errors.New("departure_token is required (from offers_search outbound results)")
	}
	if currency == "" {
		currency = "USD"
	}
	if country == "" {
		country = "us"
	}
	if language == "" {
		language = "en"
	}

	params := url.Values{}
	params.Set("engine", "google_flights")
	params.Set("departure_token", departureToken)
	params.Set("currency", currency)
	params.Set("gl", country)
	params.Set("hl", language)

	var raw rawFlightsResponse
	if err := c.GetJSON(ctx, params, &raw); err != nil {
		return nil, err
	}

	if cur := raw.SearchParameters.Currency; cur != "" {
		currency = cur
	}
	merged := append([]rawOffer{}, raw.BestFlights...)
	merged = append(merged, raw.OtherFlights...)
	offers := make([]FlightOffer, 0, len(merged))
	for i := range merged {
		offers = append(offers, normalizeOffer(merged[i], currency))
	}

	out := &OfferSearchResult{
		TripType:         "round_trip",
		Currency:         currency,
		GoogleFlightsURL: raw.SearchMetadata.GoogleFlightsURL,
		Offers:           offers,
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
	if len(offers) == 0 {
		out.Recommendation = "No return options for this departure_token — re-run offers_search and pick another outbound."
	} else {
		out.Recommendation = recommendOffers(out) + " Next: call booking_options_get with booking_token from the chosen return offer."
	}
	out.Usage = c.usageOrNil(ctx)
	return out, nil
}

func normalizeBookingOption(d *rawBookingOptionDetail, mode, currency string) BookingOption {
	opt := BookingOption{
		BookWith:      d.BookWith,
		OptionTitle:   d.OptionTitle,
		Price:         d.Price,
		Currency:      currency,
		MarketedAs:    d.MarketedAs,
		Extensions:    d.Extensions,
		BaggagePrices: d.BaggagePrices,
		IsAirline:     d.Airline,
		TicketMode:    mode,
		Refundable:    detectRefundable(d.OptionTitle, d.Extensions),
	}
	if len(d.LocalPrices) > 0 && d.LocalPrices[0].Currency != "" {
		opt.Currency = d.LocalPrices[0].Currency
		if d.LocalPrices[0].Price > 0 {
			opt.Price = d.LocalPrices[0].Price
		}
	}
	if d.BookingRequest != nil && d.BookingRequest.URL != "" {
		method := "GET"
		note := "Open booking.url in the browser (GET)."
		if strings.TrimSpace(d.BookingRequest.PostData) != "" {
			method = "POST"
			note = "POST booking.url with body = booking.post_data exactly (do not modify)."
		}
		opt.Booking = &BookingRequest{
			URL:      d.BookingRequest.URL,
			PostData: d.BookingRequest.PostData,
			Method:   method,
			Note:     note,
		}
	}
	opt.Summary = summarizeBookingOption(opt)
	return opt
}

func summarizeBookingOption(o BookingOption) string {
	title := o.OptionTitle
	if title == "" {
		title = "fare"
	}
	parts := []string{
		fmt.Sprintf("%.0f %s", o.Price, o.Currency),
		o.BookWith,
		title,
	}
	switch o.Refundable {
	case RefundableYes:
		parts = append(parts, "refundable")
	case RefundableNo:
		parts = append(parts, "non-refundable")
	}
	if o.Booking != nil {
		parts = append(parts, o.Booking.Method+" checkout")
	}
	return strings.Join(parts, " · ")
}

func recommendBookingOptions(opts []BookingOption) string {
	if len(opts) == 0 {
		return "No checkout options."
	}
	best := opts[0]
	bestIdx := 0
	for i := 1; i < len(opts); i++ {
		o := &opts[i]
		if o.Price > 0 && (best.Price == 0 || o.Price < best.Price) {
			best = *o
			bestIdx = i
		}
	}
	// Prefer an explicitly refundable fare if within 20% of cheapest.
	pick := best
	pickIdx := bestIdx
	for i := range opts {
		o := &opts[i]
		if o.Refundable != RefundableYes || o.Price <= 0 {
			continue
		}
		if o.Price <= best.Price*1.20 && (pick.Refundable != RefundableYes || o.Price < pick.Price) {
			pick = *o
			pickIdx = i
		}
	}
	msg := fmt.Sprintf("Cheapest checkout option #%d: %s.", bestIdx+1, best.Summary)
	if pickIdx != bestIdx {
		msg = fmt.Sprintf("Prefer refundable option #%d: %s. (cheapest is #%d at %.0f %s)",
			pickIdx+1, pick.Summary, bestIdx+1, best.Price, best.Currency)
	}
	if pick.Booking != nil || best.Booking != nil {
		msg += " Use options[].booking for the real buy handoff (not google_flights_url)."
	}
	return msg
}
