package mcp

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"

	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/shotah/rentals-search-mcp/internal/rentcast"
)

// Host server id for ai-gantry is "rentals" → tools appear as rentals__{tool}.
// Tool names must NOT start with "rentals_" (no double prefix).
const ServerName = "rentals-search-mcp"

// ServerVersion is set at build time via ldflags.
var ServerVersion = "dev"

// RentalsAPI is the RentCast surface used by tools (mockable in tests).
type RentalsAPI interface {
	SearchListings(ctx context.Context, req rentcast.ListingsSearchRequest) (*rentcast.ListingsSearchResult, error)
	GetListing(ctx context.Context, id, intent string) (*rentcast.ListingGetResult, error)
	RentEstimate(ctx context.Context, req rentcast.RentEstimateRequest) (*rentcast.RentEstimateResult, error)
	MarketStats(ctx context.Context, zipCode string) (*rentcast.MarketStatsResult, error)
	AccountUsage() *rentcast.Usage
}

// Server is the stdio MCP rental search surface.
type Server struct {
	Log    *log.Logger
	Client RentalsAPI
}

// New creates an MCP server. Client may be nil until Run (loaded from env).
func New(client RentalsAPI) *Server {
	return &Server{
		Log:    log.New(os.Stderr, "rentals-search-mcp: ", log.LstdFlags|log.Lmsgprefix),
		Client: client,
	}
}

// RegisteredToolNames returns tool names in registration order (for tests).
func RegisteredToolNames() []string {
	return []string{
		"listings_search",
		"listings_get",
		"rent_estimate_get",
		"markets_get",
		"areas_resolve",
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
		Name: "listings_search",
		Description: "Search US long-term FOR-RENT residential listings (default). Burns 1 RentCast request to GET /listings/rental/long-term. " +
			"Pass intent=buy only for homes for sale. HARD CAP 50/month — blocked with no model bypass. After the soft cap (~40) re-call with confirm_spend=true. " +
			"THRIFTY: pass multiple neighborhoods as comma-separated neighborhood=Ballard,Fremont OR zip_codes=98107,98103 " +
			"AND/OR property_type=house,condo for ONE call — never one search per area or type. " +
			"Filter tightly (bedrooms, price_max, new_this_week). Soft pets/parking/laundry prefs are not API filters. " +
			"Handoff is agent/office phone and email (who is marketing the rental). RentCast has no Zillow listing URL. " +
			"Does not apply, make offers, or contact landlords/agents.",
	}, s.listingsSearch)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "listings_get",
		Description: "Get one FOR-RENT listing by id (default catalog /listings/rental/long-term/{id}; burns 1 RentCast request). " +
			"Only after the human picks a candidate from search. HARD CAP 50/month; after soft cap use confirm_spend=true. " +
			"Pass intent=buy only if the id came from a buy search. " +
			"Present agent/office phone and email. Does not apply, make offers, or contact landlords/agents.",
	}, s.listingsGet)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "rent_estimate_get",
		Description: "Fair-rent AVM for one address (burns 1 RentCast request). Use sparingly when asking if a listed rent is reasonable. " +
			"HARD CAP 50/month; after soft cap use confirm_spend=true. Not for commercial spaces.",
	}, s.rentEstimateGet)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "markets_get",
		Description: "Zip rental market aggregates (burns 1 RentCast request). Optional context — skip if quota is tight; " +
			"prefer a tight listings_search instead. HARD CAP 50/month; after soft cap use confirm_spend=true.",
	}, s.marketsGet)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "areas_resolve",
		Description: "FREE (no RentCast call). Resolve Seattle neighborhood name(s) to zips/lat/lng. " +
			"Use list_all=true once, then ONE listings_search with neighborhood=A,B,C or zip_codes=… — not N searches.",
	}, s.areasResolve)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "link_format",
		Description: "FREE public search URL fallback (no RentCast call). Defaults to Zillow for_rent. " +
			"Pass intent=buy only for for_sale. Prefer when usage.cap_state is confirm_required or exhausted.",
	}, s.linkFormat)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "account_get",
		Description: "FREE local usage counter (requests_used / requests_left / cap_state / period_resets on the 1st). " +
			"Check before burning RentCast calls. Soft cap needs confirm_spend; hard cap (50) cannot be unlocked by the model. " +
			"Does not call the network.",
	}, s.accountGet)

	return server
}

// Run starts the MCP server over stdio. Logs go to stderr only.
func (s *Server) Run(ctx context.Context) error {
	if s.Client == nil {
		c, err := rentcast.NewFromEnv()
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

// SelfTest validates tool registration and a dry (stub) client path — no API key.
func SelfTest() error {
	names := RegisteredToolNames()
	if len(names) == 0 {
		return errors.New("no tools registered")
	}
	for _, n := range names {
		if strings.HasPrefix(n, "rentals_") {
			return fmt.Errorf("tool %q must not start with rentals_ (double prefix)", n)
		}
		parts := strings.Split(n, "_")
		if len(parts) < 2 {
			return fmt.Errorf("tool %q must be service_verb…", n)
		}
	}

	stub := rentcast.NewStub()
	s := New(stub)
	_ = s.newMCPServer()

	ctx := context.Background()
	if _, err := stub.SearchListings(ctx, rentcast.ListingsSearchRequest{
		Intent: rentcast.IntentRent, City: "Seattle", State: "WA", Limit: 5,
	}); err != nil {
		return fmt.Errorf("stub SearchListings: %w", err)
	}
	if _, err := stub.GetListing(ctx, "self-test-id", rentcast.IntentRent); err != nil {
		return fmt.Errorf("stub GetListing: %w", err)
	}
	if _, err := stub.RentEstimate(ctx, rentcast.RentEstimateRequest{
		Address: "1 Main St, Seattle, WA 98101",
	}); err != nil {
		return fmt.Errorf("stub RentEstimate: %w", err)
	}
	if _, err := stub.MarketStats(ctx, "98101"); err != nil {
		return fmt.Errorf("stub MarketStats: %w", err)
	}
	if pt := rentcast.NormalizePropertyType("apartment"); pt != "Apartment" {
		return fmt.Errorf("NormalizePropertyType: got %q", pt)
	}
	if _, err := rentcast.ResolveAreas(rentcast.AreaResolveRequest{Neighborhood: "Capitol Hill"}); err != nil {
		return fmt.Errorf("ResolveAreas: %w", err)
	}
	return nil
}
