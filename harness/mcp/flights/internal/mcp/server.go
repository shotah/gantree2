package mcp

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/shotah/flights-search-mcp/internal/serpapi"
)

// Host server id for ai-gantry is "flights" → tools appear as flights__{tool}.
// Tool names must NOT start with "flights_" (no double prefix).
const ServerName = "flights-search-mcp"

// ServerVersion is set at build time via ldflags.
var ServerVersion = "dev"

// FlightsAPI is the SerpAPI surface used by tools (mockable in tests).
type FlightsAPI interface {
	SearchOffers(ctx context.Context, req serpapi.OfferSearchRequest) (*serpapi.OfferSearchResult, error)
	SearchDates(ctx context.Context, req serpapi.DatesSearchRequest) (*serpapi.DatesSearchResult, error)
	SearchAirports(ctx context.Context, query, country, language string) (*serpapi.AirportsSearchResult, error)
	SelectDeparture(ctx context.Context, departureToken, currency, country, language string) (*serpapi.OfferSearchResult, error)
	GetBookingOptions(ctx context.Context, req serpapi.BookingOptionsRequest) (*serpapi.BookingOptionsResult, error)
	Account(ctx context.Context) (*serpapi.Usage, error)
}

// Server is the stdio MCP flight search surface.
type Server struct {
	Log    *log.Logger
	Client FlightsAPI
}

// New creates an MCP server. Client may be nil until Run (loaded from env).
func New(client FlightsAPI) *Server {
	return &Server{
		Log:    log.New(os.Stderr, "flights-search-mcp: ", log.LstdFlags|log.Lmsgprefix),
		Client: client,
	}
}

// RegisteredToolNames returns tool names in registration order (for tests).
func RegisteredToolNames() []string {
	return []string{
		"offers_search",
		"dates_search",
		"airports_search",
		"returns_search",
		"booking_options_get",
		"link_format",
		"account_get",
	}
}

// newMCPServer builds the protocol server with tools registered.
func (s *Server) newMCPServer() *sdkmcp.Server {
	server := sdkmcp.NewServer(&sdkmcp.Implementation{
		Name:    ServerName,
		Version: ServerVersion,
	}, nil)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "offers_search",
		Description: "Search Google Flights prices and itineraries for fixed dates (one-way or round-trip). " +
			"Returns ranked offers with summaries, price_insights (level, typical range, price_history), " +
			"departure_token / booking_token, and a fallback google_flights_url. " +
			"Supports include_airlines/exclude_airlines (IATA, SKYTEAM/ONEWORLD/STAR_ALLIANCE, or " +
			"alaska_partners/delta_partners), exclude_basic (US domestic economy only; not refundable), " +
			"and fly_america=annotate|filter (heuristic marketing-designator hint — not legal certification). " +
			"For real checkout: one-way → booking_options_get(booking_token); round-trip outbound → " +
			"returns_search(departure_token) then booking_options_get. Does not purchase tickets. " +
			"Prefer IATA codes; call airports_search if the city is ambiguous. Prefer dates_search when dates are flexible.",
	}, s.offersSearch)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "dates_search",
		Description: "Scan Google Flights prices across a departure date window to find cheaper days. " +
			"One-way by default; stay_nights for a fixed round-trip length; stay_nights_min/max (e.g. 4 and 7) " +
			"to spread samples across a stay-length range within the same ≤7 SerpAPI call budget. " +
			"Supports include_airlines/exclude_airlines (same tokens as offers_search). " +
			"Use before locking dates, then confirm with offers_search. Does not purchase tickets.",
	}, s.datesSearch)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "airports_search",
		Description: "Resolve a city or airport name to IATA codes / Google location ids for flight search. " +
			"Call this before offers_search when the human names a city (Seattle, Paris) instead of an airport code.",
	}, s.airportsSearch)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "returns_search",
		Description: "Select an outbound flight via departure_token from offers_search and load return-leg options " +
			"(with booking_token). Required for round-trip checkout. Then call booking_options_get. " +
			"Does not purchase tickets.",
	}, s.returnsSearch)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "booking_options_get",
		Description: "Get real airline/OTA checkout options for a booking_token from offers_search or returns_search. " +
			"Returns book_with, fare title, price, refundable (yes/no/unknown from Google text), " +
			"and booking.url (+ booking.post_data when Google requires POST). " +
			"Set refundable_only=true to drop options Google labels as non-refundable. " +
			"This is the real buy path — not google_flights_url. Does not purchase tickets itself.",
	}, s.bookingOptionsGet)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "link_format",
		Description: "Build a Google Flights SEARCH URL with route/dates prefilled via q= (fallback only). " +
			"Does NOT open a specific fare checkout — prefer booking_options_get for buy links. " +
			"No API call and no purchase.",
	}, s.linkFormat)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "account_get",
		Description: "Check SerpAPI monthly search usage and plan renewal/reset date without running a flight search. " +
			"This account check is free and does not burn quota. Search tools also attach a usage snapshot on their responses.",
	}, s.accountGet)

	return server
}

// Run starts the MCP server over stdio. Logs go to stderr only.
func (s *Server) Run(ctx context.Context) error {
	if s.Client == nil {
		c, err := serpapi.NewFromEnv()
		if err != nil {
			return err
		}
		s.Client = c
	}
	return s.serve(ctx, &sdkmcp.StdioTransport{})
}

func (s *Server) serve(ctx context.Context, transport sdkmcp.Transport) error {
	server := s.newMCPServer()
	s.Log.Printf("starting stdio MCP (%s %s) tools=%s",
		ServerName, ServerVersion, strings.Join(RegisteredToolNames(), ","))
	return server.Run(ctx, transport)
}

type offersSearchInput struct {
	Origin          string `json:"origin" jsonschema:"Departure airport IATA code or Google location id (e.g. SEA or /m/0d9jr)"`
	Destination     string `json:"destination" jsonschema:"Arrival airport IATA code or Google location id (e.g. CDG)"`
	OutboundDate    string `json:"outbound_date" jsonschema:"Departure date YYYY-MM-DD"`
	ReturnDate      string `json:"return_date,omitempty" jsonschema:"Return date YYYY-MM-DD for round-trip; omit for one-way"`
	Adults          int    `json:"adults,omitempty" jsonschema:"Number of adults (default 1)"`
	TravelClass     string `json:"travel_class,omitempty" jsonschema:"economy (default), premium_economy, business, or first"`
	Stops           string `json:"stops,omitempty" jsonschema:"any (default), nonstop, 1_or_fewer, or 2_or_fewer"`
	SortBy          string `json:"sort_by,omitempty" jsonschema:"top (default), price, or duration"`
	Currency        string `json:"currency,omitempty" jsonschema:"Currency code (default USD)"`
	Country         string `json:"country,omitempty" jsonschema:"Google country code gl (default us)"`
	Language        string `json:"language,omitempty" jsonschema:"Language code hl (default en)"`
	MaxPrice        int    `json:"max_price,omitempty" jsonschema:"Maximum ticket price filter"`
	MaxResults      int    `json:"max_results,omitempty" jsonschema:"Max offers to return (default 10)"`
	DeepSearch      bool   `json:"deep_search,omitempty" jsonschema:"If true, slower SerpAPI deep search matching browser results"`
	IncludeAirlines string `json:"include_airlines,omitempty" jsonschema:"Comma-separated IATA codes and/or SKYTEAM, ONEWORLD, STAR_ALLIANCE; presets alaska_partners or delta_partners. Cannot combine with exclude_airlines."`
	ExcludeAirlines string `json:"exclude_airlines,omitempty" jsonschema:"Comma-separated IATA codes and/or alliances to exclude. Cannot combine with include_airlines."`
	ExcludeBasic    bool   `json:"exclude_basic,omitempty" jsonschema:"Exclude basic economy (free seat + carry-on). SerpAPI: US domestic + economy only. Not the same as refundable."`
	FlyAmerica      string `json:"fly_america,omitempty" jsonschema:"annotate (label offers) or filter (drop likely_foreign). Heuristic on marketing designators only — not legal certification."`
	Funding         string `json:"funding,omitempty" jsonschema:"civilian (default) or dod — affects Open Skies hint text only"`
}

func (s *Server) offersSearch(ctx context.Context, _ *sdkmcp.CallToolRequest, in offersSearchInput) (*sdkmcp.CallToolResult, serpapi.OfferSearchResult, error) {
	if s.Client == nil {
		return toolError("SERPAPI_API_KEY is required"), serpapi.OfferSearchResult{}, nil
	}
	res, err := s.Client.SearchOffers(ctx, serpapi.OfferSearchRequest{
		Origin:          in.Origin,
		Destination:     in.Destination,
		OutboundDate:    in.OutboundDate,
		ReturnDate:      in.ReturnDate,
		Adults:          in.Adults,
		TravelClass:     in.TravelClass,
		Stops:           in.Stops,
		SortBy:          in.SortBy,
		Currency:        in.Currency,
		Country:         in.Country,
		Language:        in.Language,
		MaxPrice:        in.MaxPrice,
		MaxResults:      in.MaxResults,
		DeepSearch:      in.DeepSearch,
		IncludeAirlines: in.IncludeAirlines,
		ExcludeAirlines: in.ExcludeAirlines,
		ExcludeBasic:    in.ExcludeBasic,
		FlyAmerica:      in.FlyAmerica,
		Funding:         in.Funding,
	})
	if err != nil {
		return toolError(err.Error()), serpapi.OfferSearchResult{}, nil
	}
	return nil, *res, nil
}

type datesSearchInput struct {
	Origin          string `json:"origin" jsonschema:"Departure airport IATA code"`
	Destination     string `json:"destination" jsonschema:"Arrival airport IATA code"`
	StartDate       string `json:"start_date" jsonschema:"Outbound window start YYYY-MM-DD"`
	EndDate         string `json:"end_date" jsonschema:"Outbound window end YYYY-MM-DD"`
	StayNights      int    `json:"stay_nights,omitempty" jsonschema:"If >0, fixed round-trip stay (return = outbound + nights). Wins over min/max."`
	StayNightsMin   int    `json:"stay_nights_min,omitempty" jsonschema:"Min stay nights for a range scan (e.g. 4). Use with stay_nights_max."`
	StayNightsMax   int    `json:"stay_nights_max,omitempty" jsonschema:"Max stay nights for a range scan (e.g. 7). Samples spread across the range within max_samples."`
	Currency        string `json:"currency,omitempty" jsonschema:"Currency code (default USD)"`
	Stops           string `json:"stops,omitempty" jsonschema:"any (default), nonstop, 1_or_fewer, or 2_or_fewer"`
	TravelClass     string `json:"travel_class,omitempty" jsonschema:"economy (default), premium_economy, business, or first"`
	MaxSamples      int    `json:"max_samples,omitempty" jsonschema:"How many samples (default 5, max 7) — each sample is one SerpAPI search"`
	IncludeAirlines string `json:"include_airlines,omitempty" jsonschema:"Same tokens as offers_search include_airlines"`
	ExcludeAirlines string `json:"exclude_airlines,omitempty" jsonschema:"Same tokens as offers_search exclude_airlines"`
}

func (s *Server) datesSearch(ctx context.Context, _ *sdkmcp.CallToolRequest, in datesSearchInput) (*sdkmcp.CallToolResult, serpapi.DatesSearchResult, error) {
	if s.Client == nil {
		return toolError("SERPAPI_API_KEY is required"), serpapi.DatesSearchResult{}, nil
	}
	res, err := s.Client.SearchDates(ctx, serpapi.DatesSearchRequest{
		Origin:          in.Origin,
		Destination:     in.Destination,
		StartDate:       in.StartDate,
		EndDate:         in.EndDate,
		StayNights:      in.StayNights,
		StayNightsMin:   in.StayNightsMin,
		StayNightsMax:   in.StayNightsMax,
		Currency:        in.Currency,
		Stops:           in.Stops,
		TravelClass:     in.TravelClass,
		MaxSamples:      in.MaxSamples,
		IncludeAirlines: in.IncludeAirlines,
		ExcludeAirlines: in.ExcludeAirlines,
	})
	if err != nil {
		return toolError(err.Error()), serpapi.DatesSearchResult{}, nil
	}
	return nil, *res, nil
}

type airportsSearchInput struct {
	Query    string `json:"query" jsonschema:"City or airport name to resolve (e.g. Seattle, Charles de Gaulle)"`
	Country  string `json:"country,omitempty" jsonschema:"Google country code gl (default us)"`
	Language string `json:"language,omitempty" jsonschema:"Language code hl (default en)"`
}

func (s *Server) airportsSearch(ctx context.Context, _ *sdkmcp.CallToolRequest, in airportsSearchInput) (*sdkmcp.CallToolResult, serpapi.AirportsSearchResult, error) {
	if s.Client == nil {
		return toolError("SERPAPI_API_KEY is required"), serpapi.AirportsSearchResult{}, nil
	}
	res, err := s.Client.SearchAirports(ctx, in.Query, in.Country, in.Language)
	if err != nil {
		return toolError(err.Error()), serpapi.AirportsSearchResult{}, nil
	}
	return nil, *res, nil
}

type returnsSearchInput struct {
	DepartureToken string `json:"departure_token" jsonschema:"departure_token from an offers_search outbound offer"`
	Currency       string `json:"currency,omitempty" jsonschema:"Currency code (default USD)"`
	Country        string `json:"country,omitempty" jsonschema:"Google country code gl (default us)"`
	Language       string `json:"language,omitempty" jsonschema:"Language code hl (default en)"`
}

func (s *Server) returnsSearch(ctx context.Context, _ *sdkmcp.CallToolRequest, in returnsSearchInput) (*sdkmcp.CallToolResult, serpapi.OfferSearchResult, error) {
	if s.Client == nil {
		return toolError("SERPAPI_API_KEY is required"), serpapi.OfferSearchResult{}, nil
	}
	res, err := s.Client.SelectDeparture(ctx, in.DepartureToken, in.Currency, in.Country, in.Language)
	if err != nil {
		return toolError(err.Error()), serpapi.OfferSearchResult{}, nil
	}
	return nil, *res, nil
}

type bookingOptionsGetInput struct {
	BookingToken   string `json:"booking_token" jsonschema:"booking_token from offers_search (one-way) or returns_search (round-trip)"`
	Currency       string `json:"currency,omitempty" jsonschema:"Currency code (default USD)"`
	Country        string `json:"country,omitempty" jsonschema:"Google country code gl (default us)"`
	Language       string `json:"language,omitempty" jsonschema:"Language code hl (default en)"`
	RefundableOnly bool   `json:"refundable_only,omitempty" jsonschema:"If true, drop options Google labels as non-refundable; keeps yes and unknown"`
}

func (s *Server) bookingOptionsGet(ctx context.Context, _ *sdkmcp.CallToolRequest, in bookingOptionsGetInput) (*sdkmcp.CallToolResult, serpapi.BookingOptionsResult, error) {
	if s.Client == nil {
		return toolError("SERPAPI_API_KEY is required"), serpapi.BookingOptionsResult{}, nil
	}
	res, err := s.Client.GetBookingOptions(ctx, serpapi.BookingOptionsRequest{
		BookingToken:   in.BookingToken,
		Currency:       in.Currency,
		Country:        in.Country,
		Language:       in.Language,
		RefundableOnly: in.RefundableOnly,
	})
	if err != nil {
		return toolError(err.Error()), serpapi.BookingOptionsResult{}, nil
	}
	return nil, *res, nil
}

type linkFormatInput struct {
	Origin       string `json:"origin" jsonschema:"Departure IATA code"`
	Destination  string `json:"destination" jsonschema:"Arrival IATA code"`
	OutboundDate string `json:"outbound_date" jsonschema:"Departure date YYYY-MM-DD"`
	ReturnDate   string `json:"return_date,omitempty" jsonschema:"Return date YYYY-MM-DD for round-trip"`
	Currency     string `json:"currency,omitempty" jsonschema:"Currency code (default USD)"`
	Country      string `json:"country,omitempty" jsonschema:"Google country code gl (default us)"`
	Language     string `json:"language,omitempty" jsonschema:"Language code hl (default en)"`
}

type linkFormatOutput struct {
	GoogleFlightsURL string `json:"google_flights_url"`
	Note             string `json:"note"`
}

func (s *Server) linkFormat(_ context.Context, _ *sdkmcp.CallToolRequest, in linkFormatInput) (*sdkmcp.CallToolResult, linkFormatOutput, error) {
	if strings.TrimSpace(in.Origin) == "" || strings.TrimSpace(in.Destination) == "" || strings.TrimSpace(in.OutboundDate) == "" {
		return toolError("origin, destination, and outbound_date are required"), linkFormatOutput{}, nil
	}
	u := serpapi.BuildGoogleFlightsURL(serpapi.LinkParams{
		Origin:       in.Origin,
		Destination:  in.Destination,
		OutboundDate: in.OutboundDate,
		ReturnDate:   in.ReturnDate,
		Currency:     in.Currency,
		Country:      in.Country,
		Language:     in.Language,
	})
	return nil, linkFormatOutput{
		GoogleFlightsURL: u,
		Note:             "Fallback search URL only. Prefer booking_options_get for real checkout. This MCP never purchases tickets.",
	}, nil
}

type accountGetInput struct{}

func (s *Server) accountGet(ctx context.Context, _ *sdkmcp.CallToolRequest, _ accountGetInput) (*sdkmcp.CallToolResult, serpapi.Usage, error) {
	if s.Client == nil {
		return toolError("SERPAPI_API_KEY is required"), serpapi.Usage{}, nil
	}
	u, err := s.Client.Account(ctx)
	if err != nil {
		return toolError(err.Error()), serpapi.Usage{}, nil
	}
	if u == nil {
		return toolError("no account usage returned"), serpapi.Usage{}, nil
	}
	return nil, *u, nil
}

func toolError(msg string) *sdkmcp.CallToolResult {
	return &sdkmcp.CallToolResult{
		IsError: true,
		Content: []sdkmcp.Content{&sdkmcp.TextContent{Text: msg}},
	}
}

// SelfTest runs offline smoke checks (no network / no SerpAPI key).
func SelfTest() error {
	fmt.Fprintf(os.Stderr, "version=%s\n", ServerVersion)

	names := RegisteredToolNames()
	if len(names) != 7 {
		return fmt.Errorf("expected 7 tools, got %d", len(names))
	}
	for _, n := range names {
		if strings.HasPrefix(n, "flights_") {
			return fmt.Errorf("tool %q must not include server id prefix", n)
		}
	}
	fmt.Fprintf(os.Stderr, "tools=%s\n", strings.Join(names, ","))

	u := serpapi.BuildGoogleFlightsURL(serpapi.LinkParams{
		Origin: "SEA", Destination: "CDG", OutboundDate: "2026-09-01",
	})
	if !strings.Contains(u, "q=") || !strings.Contains(u, "SEA") {
		return fmt.Errorf("link_format smoke failed: %s", u)
	}
	fmt.Fprintf(os.Stderr, "link_format_smoke=ok\n")
	return nil
}
