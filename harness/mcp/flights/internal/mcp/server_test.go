package mcp

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/shotah/flights-search-mcp/internal/serpapi"
)

type fakeAPI struct {
	offers   *serpapi.OfferSearchResult
	dates    *serpapi.DatesSearchResult
	airports *serpapi.AirportsSearchResult
	booking  *serpapi.BookingOptionsResult
	usage    *serpapi.Usage
	err      error
}

func (f *fakeAPI) SearchOffers(context.Context, serpapi.OfferSearchRequest) (*serpapi.OfferSearchResult, error) {
	return f.offers, f.err
}

func (f *fakeAPI) SearchDates(context.Context, serpapi.DatesSearchRequest) (*serpapi.DatesSearchResult, error) {
	return f.dates, f.err
}

func (f *fakeAPI) SearchAirports(context.Context, string, string, string) (*serpapi.AirportsSearchResult, error) {
	return f.airports, f.err
}

func (f *fakeAPI) SelectDeparture(context.Context, string, string, string, string) (*serpapi.OfferSearchResult, error) {
	return f.offers, f.err
}

func (f *fakeAPI) GetBookingOptions(context.Context, serpapi.BookingOptionsRequest) (*serpapi.BookingOptionsResult, error) {
	return f.booking, f.err
}

func (f *fakeAPI) Account(context.Context) (*serpapi.Usage, error) {
	return f.usage, f.err
}

func TestOffersSearchTool(t *testing.T) {
	t.Parallel()
	s := New(&fakeAPI{offers: &serpapi.OfferSearchResult{
		Origin: "SEA", Destination: "SFO", Recommendation: "ok",
		Offers: []serpapi.FlightOffer{{Price: 120, Currency: "USD"}},
	}})
	_, out, err := s.offersSearch(context.Background(), nil, offersSearchInput{
		Origin: "SEA", Destination: "SFO", OutboundDate: "2026-09-01",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Offers) != 1 || out.Offers[0].Price != 120 {
		t.Fatalf("%+v", out)
	}
}

func TestOffersSearchToolError(t *testing.T) {
	t.Parallel()
	s := New(&fakeAPI{err: errors.New("boom")})
	res, _, err := s.offersSearch(context.Background(), nil, offersSearchInput{
		Origin: "SEA", Destination: "SFO", OutboundDate: "2026-09-01",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res == nil || !res.IsError {
		t.Fatal("expected tool error")
	}
}

func TestBookingOptionsGetTool(t *testing.T) {
	t.Parallel()
	s := New(&fakeAPI{booking: &serpapi.BookingOptionsResult{
		Options: []serpapi.BookingOption{{
			BookWith: "Alaska", Price: 199, Currency: "USD",
			Booking: &serpapi.BookingRequest{URL: "https://www.google.com/travel/clk/f", Method: "POST", PostData: "u=x"},
		}},
	}})
	_, out, err := s.bookingOptionsGet(context.Background(), nil, bookingOptionsGetInput{BookingToken: "tok"})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Options) != 1 || out.Options[0].Booking.Method != http.MethodPost {
		t.Fatalf("%+v", out)
	}
}

func TestReturnsSearchTool(t *testing.T) {
	t.Parallel()
	s := New(&fakeAPI{offers: &serpapi.OfferSearchResult{
		Offers: []serpapi.FlightOffer{{Price: 400, BookingToken: "bt"}},
	}})
	_, out, err := s.returnsSearch(context.Background(), nil, returnsSearchInput{DepartureToken: "dt"})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Offers) != 1 || out.Offers[0].BookingToken != "bt" {
		t.Fatalf("%+v", out)
	}
}

func TestAccountGetTool(t *testing.T) {
	t.Parallel()
	s := New(&fakeAPI{usage: &serpapi.Usage{
		SearchesUsed: 12, SearchesLeft: 238, SearchesPerMonth: 250,
		PlanRenewalDate: "2026-09-01",
	}})
	_, out, err := s.accountGet(context.Background(), nil, accountGetInput{})
	if err != nil {
		t.Fatal(err)
	}
	if out.SearchesUsed != 12 || out.PlanRenewalDate != "2026-09-01" {
		t.Fatalf("%+v", out)
	}
}

func TestDatesSearchTool(t *testing.T) {
	t.Parallel()
	s := New(&fakeAPI{dates: &serpapi.DatesSearchResult{
		CheapestDate: "2026-09-03", CheapestPrice: 99,
	}})
	_, out, err := s.datesSearch(context.Background(), nil, datesSearchInput{
		Origin: "SEA", Destination: "SFO", StartDate: "2026-09-01", EndDate: "2026-09-07",
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.CheapestDate != "2026-09-03" {
		t.Fatalf("%+v", out)
	}
}

func TestAirportsSearchTool(t *testing.T) {
	t.Parallel()
	s := New(&fakeAPI{airports: &serpapi.AirportsSearchResult{
		Query: "Seattle",
		Suggestions: []serpapi.AirportHit{{
			Name: "Seattle", Airports: []serpapi.AirportBrief{{ID: "SEA"}},
		}},
	}})
	_, out, err := s.airportsSearch(context.Background(), nil, airportsSearchInput{Query: "Seattle"})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Suggestions) != 1 {
		t.Fatalf("%+v", out)
	}
}

func TestLinkFormatTool(t *testing.T) {
	t.Parallel()
	s := New(nil)
	_, out, err := s.linkFormat(context.Background(), nil, linkFormatInput{
		Origin: "sea", Destination: "cdg", OutboundDate: "2026-09-01",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.GoogleFlightsURL, "q=") || !strings.Contains(out.GoogleFlightsURL, "SEA") {
		t.Fatalf("%+v", out)
	}
}

func TestLinkFormatToolError(t *testing.T) {
	t.Parallel()
	s := New(nil)
	res, _, err := s.linkFormat(context.Background(), nil, linkFormatInput{})
	if err != nil {
		t.Fatal(err)
	}
	if res == nil || !res.IsError {
		t.Fatal("expected tool error")
	}
}

func TestSelfTest(t *testing.T) {
	t.Parallel()
	if err := SelfTest(); err != nil {
		t.Fatal(err)
	}
}

func TestNilClientToolErrors(t *testing.T) {
	t.Parallel()
	s := New(nil)
	res, _, err := s.offersSearch(context.Background(), nil, offersSearchInput{
		Origin: "SEA", Destination: "SFO", OutboundDate: "2026-09-01",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res == nil || !res.IsError {
		t.Fatal("expected missing client error")
	}
}

func TestServeViaInMemoryTransport(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	s := New(&fakeAPI{offers: &serpapi.OfferSearchResult{
		Offers: []serpapi.FlightOffer{{Price: 1, Currency: "USD"}},
	}})
	t1, t2 := sdkmcp.NewInMemoryTransports()

	errCh := make(chan error, 1)
	go func() {
		errCh <- s.serve(ctx, t1)
	}()

	client := sdkmcp.NewClient(&sdkmcp.Implementation{Name: "test", Version: "v0"}, nil)
	clientSession, err := client.Connect(ctx, t2, nil)
	if err != nil {
		t.Fatalf("client connect: %v", err)
	}

	tools, err := clientSession.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("ListTools: %v", err)
	}
	if len(tools.Tools) != 7 {
		t.Fatalf("tools=%d want 7", len(tools.Tools))
	}

	linkRes, err := clientSession.CallTool(ctx, &sdkmcp.CallToolParams{
		Name: "link_format",
		Arguments: map[string]any{
			"origin": "JFK", "destination": "LAX", "outbound_date": "2026-08-15",
		},
	})
	if err != nil {
		t.Fatalf("link_format: %v", err)
	}
	if linkRes.IsError {
		t.Fatalf("link_format error: %+v", linkRes)
	}

	_ = clientSession.Close()
	cancel()
	select {
	case err := <-errCh:
		if err != nil && !errors.Is(err, context.Canceled) {
			t.Fatalf("serve: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("serve did not exit")
	}
}

var _ sdkmcp.Content = (*sdkmcp.TextContent)(nil)
