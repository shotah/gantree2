package mcp

import (
	"regexp"
	"strings"
	"testing"

	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/shotah/rentals-search-mcp/internal/rentcast"
)

var toolNameRE = regexp.MustCompile(`^[a-z]+(_[a-z0-9]+)+$`)

func TestRegisteredToolNames(t *testing.T) {
	names := RegisteredToolNames()
	if len(names) != 7 {
		t.Fatalf("want 7 tools, got %d: %v", len(names), names)
	}
	for _, n := range names {
		if strings.HasPrefix(n, "rentals_") {
			t.Fatalf("tool %q must not start with rentals_", n)
		}
		if !toolNameRE.MatchString(n) {
			t.Fatalf("tool %q does not match service_verb… pattern", n)
		}
	}
}

func TestSelfTest(t *testing.T) {
	if err := SelfTest(); err != nil {
		t.Fatal(err)
	}
}

func TestListingsSearchStub(t *testing.T) {
	s := New(rentcast.NewStub())
	res, out, err := s.listingsSearch(t.Context(), nil, listingsSearchInput{
		Intent:       "rent",
		City:         "Austin",
		State:        "TX",
		PropertyType: "house",
		PriceMax:     3000,
		Limit:        5,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res != nil && res.IsError {
		t.Fatalf("unexpected error result: %+v", res)
	}
	got, ok := out.(*rentcast.ListingsSearchResult)
	if !ok || got == nil {
		t.Fatalf("out type %T", out)
	}
	if got.Limit != 5 || got.Query["property_type"] != "Single Family" {
		t.Fatalf("unexpected result: %#v", got)
	}
}

func TestListingsSearchMultiPropertyTypeStub(t *testing.T) {
	s := New(rentcast.NewStub())
	res, out, err := s.listingsSearch(t.Context(), nil, listingsSearchInput{
		Intent:       "buy",
		City:         "Austin",
		State:        "TX",
		PropertyType: "house,condo",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res != nil && res.IsError {
		t.Fatalf("unexpected error result: %+v", res)
	}
	got, ok := out.(*rentcast.ListingsSearchResult)
	if !ok || got == nil || got.Query["property_type"] != "Single Family|Condo" {
		t.Fatalf("unexpected result: %#v", out)
	}
}

func TestListingsSearchNilClient(t *testing.T) {
	s := New(nil)
	res, _, err := s.listingsSearch(t.Context(), nil, listingsSearchInput{Intent: "rent", ZipCode: "98101"})
	if err != nil {
		t.Fatal(err)
	}
	if res == nil || !res.IsError {
		t.Fatal("expected client error")
	}
}

func TestMarketsGetAndRentEstimateStub(t *testing.T) {
	s := New(rentcast.NewStub())
	res, out, err := s.marketsGet(t.Context(), nil, marketsGetInput{ZipCode: "97201"})
	if err != nil {
		t.Fatal(err)
	}
	if res != nil && res.IsError {
		t.Fatalf("%+v", res)
	}
	if out == nil {
		t.Fatal("nil markets out")
	}
	res, out, err = s.rentEstimateGet(t.Context(), nil, rentEstimateInput{
		Address: "1 Main St, Portland, OR 97201",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res != nil && res.IsError {
		t.Fatalf("%+v", res)
	}
	if out == nil {
		t.Fatal("nil estimate out")
	}
}

func TestListingsGetStub(t *testing.T) {
	s := New(rentcast.NewStub())
	res, out, err := s.listingsGet(t.Context(), nil, listingsGetInput{ListingID: "abc", Intent: "buy"})
	if err != nil {
		t.Fatal(err)
	}
	if res != nil && res.IsError {
		t.Fatalf("%+v", res)
	}
	got, ok := out.(*rentcast.ListingGetResult)
	if !ok || got == nil || got.ID != "abc" || got.Intent != "buy" {
		t.Fatalf("%#v", out)
	}
}

func TestListingsGetRequiresID(t *testing.T) {
	s := New(rentcast.NewStub())
	res, _, err := s.listingsGet(t.Context(), nil, listingsGetInput{})
	if err != nil {
		t.Fatal(err)
	}
	if res == nil || !res.IsError {
		t.Fatal("expected error for missing listing_id")
	}
}

func TestAccountGet(t *testing.T) {
	s := New(rentcast.NewStub())
	res, out, err := s.accountGet(t.Context(), nil, accountGetInput{})
	if err != nil {
		t.Fatal(err)
	}
	if res != nil && res.IsError {
		t.Fatalf("unexpected error: %+v", res)
	}
	m, ok := out.(map[string]any)
	if !ok || m["provider"] != "RentCast" {
		t.Fatalf("unexpected out: %#v", out)
	}
	u, ok := m["usage"].(*rentcast.Usage)
	if !ok || u == nil || u.RequestsPerMonth != 50 || u.SoftCap != 40 || u.CapState != "ok" {
		t.Fatalf("usage %#v", m["usage"])
	}
	note, _ := m["note"].(string)
	if !strings.Contains(note, "confirm_spend") || !strings.Contains(note, "Hard cap") {
		t.Fatalf("note %q", note)
	}
}

func TestListingsSearchSoftCapRequiresConfirm(t *testing.T) {
	stub := rentcast.NewStub()
	for range 40 {
		stub.Usage.RecordSuccess()
	}
	s := New(stub)
	res, _, err := s.listingsSearch(t.Context(), nil, listingsSearchInput{
		Intent: "rent", City: "Seattle", State: "WA",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res == nil || !res.IsError {
		t.Fatal("expected soft-cap error")
	}
	text := toolErrorText(res)
	if !strings.Contains(text, "confirm_spend=true") {
		t.Fatalf("error %q", text)
	}

	res, out, err := s.listingsSearch(t.Context(), nil, listingsSearchInput{
		Intent: "rent", City: "Seattle", State: "WA", ConfirmSpend: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res != nil && res.IsError {
		t.Fatalf("confirm should pass: %+v", res)
	}
	if out == nil {
		t.Fatal("nil out")
	}
}

func TestListingsSearchHardCapCannotBypass(t *testing.T) {
	stub := rentcast.NewStub()
	for range 50 {
		stub.Usage.RecordSuccess()
	}
	s := New(stub)
	res, _, err := s.listingsSearch(t.Context(), nil, listingsSearchInput{
		Intent: "rent", City: "Seattle", State: "WA", ConfirmSpend: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res == nil || !res.IsError {
		t.Fatal("expected hard-cap error")
	}
	text := toolErrorText(res)
	if !strings.Contains(text, "HARD CAP") || !strings.Contains(text, "RENTCAST_ALLOW_OVERAGE=1") {
		t.Fatalf("error %q", text)
	}
}

func toolErrorText(res *sdkmcp.CallToolResult) string {
	if res == nil || len(res.Content) == 0 {
		return ""
	}
	tc, ok := res.Content[0].(*sdkmcp.TextContent)
	if !ok || tc == nil {
		return ""
	}
	return tc.Text
}

func TestLinkFormat(t *testing.T) {
	s := New(nil)
	res, out, err := s.linkFormat(t.Context(), nil, linkFormatInput{
		Intent: "rent", City: "Seattle", State: "WA", Neighborhood: "Ballard", PetsWanted: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res != nil && res.IsError {
		t.Fatalf("unexpected error: %+v", res)
	}
	m, ok := out.(map[string]any)
	if !ok {
		t.Fatalf("out type %T", out)
	}
	u, _ := m["search_url"].(string)
	if !strings.Contains(u, "zillow.com") || !strings.Contains(u, "for_rent") || !strings.Contains(u, "pets=true") {
		t.Fatalf("url %q", u)
	}
	if m["intent"] != "rent" {
		t.Fatalf("intent %#v", m["intent"])
	}
}

func TestLinkFormatBuy(t *testing.T) {
	s := New(nil)
	res, out, err := s.linkFormat(t.Context(), nil, linkFormatInput{
		Intent: "purchase", City: "Seattle", State: "WA",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res != nil && res.IsError {
		t.Fatalf("unexpected error: %+v", res)
	}
	m, ok := out.(map[string]any)
	if !ok {
		t.Fatalf("out type %T", out)
	}
	u, _ := m["search_url"].(string)
	if !strings.Contains(u, "for_sale") {
		t.Fatalf("url %q", u)
	}
	if m["intent"] != "buy" {
		t.Fatalf("intent %#v", m["intent"])
	}
}

func TestLinkFormatDefaultsIntentRent(t *testing.T) {
	s := New(nil)
	res, out, err := s.linkFormat(t.Context(), nil, linkFormatInput{City: "Seattle", State: "WA"})
	if err != nil {
		t.Fatal(err)
	}
	if res != nil && res.IsError {
		t.Fatalf("%+v", res)
	}
	m, ok := out.(map[string]any)
	if !ok {
		t.Fatalf("out type %T", out)
	}
	u, _ := m["search_url"].(string)
	if m["intent"] != "rent" || !strings.Contains(u, "for_rent") {
		t.Fatalf("%#v", out)
	}
}

func TestListingsSearchDefaultsIntentRent(t *testing.T) {
	s := New(rentcast.NewStub())
	res, out, err := s.listingsSearch(t.Context(), nil, listingsSearchInput{City: "Austin", State: "TX"})
	if err != nil {
		t.Fatal(err)
	}
	if res != nil && res.IsError {
		t.Fatalf("%+v", res)
	}
	got, ok := out.(*rentcast.ListingsSearchResult)
	if !ok || got == nil || got.Intent != "rent" {
		t.Fatalf("%#v", out)
	}
}

func TestListingsSearchBuyStub(t *testing.T) {
	s := New(rentcast.NewStub())
	res, out, err := s.listingsSearch(t.Context(), nil, listingsSearchInput{
		Intent: "buy", City: "Austin", State: "TX", PropertyType: "condo", PriceMax: 500000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res != nil && res.IsError {
		t.Fatalf("%+v", res)
	}
	got, ok := out.(*rentcast.ListingsSearchResult)
	if !ok || got == nil || got.Intent != "buy" || got.Query["intent"] != "buy" {
		t.Fatalf("%#v", out)
	}
}

func TestListingsGetDefaultsIntentRent(t *testing.T) {
	s := New(rentcast.NewStub())
	res, out, err := s.listingsGet(t.Context(), nil, listingsGetInput{ListingID: "abc"})
	if err != nil {
		t.Fatal(err)
	}
	if res != nil && res.IsError {
		t.Fatalf("%+v", res)
	}
	got, ok := out.(*rentcast.ListingGetResult)
	if !ok || got == nil || got.Intent != "rent" {
		t.Fatalf("%#v", out)
	}
}

func TestAreasResolve(t *testing.T) {
	s := New(nil)
	res, out, err := s.areasResolve(t.Context(), nil, areasResolveInput{Neighborhood: "u district"})
	if err != nil {
		t.Fatal(err)
	}
	if res != nil && res.IsError {
		t.Fatalf("%+v", res)
	}
	got, ok := out.(*rentcast.AreaResolveResult)
	if !ok || got.Count != 1 || got.Areas[0].Name != "University District" {
		t.Fatalf("%#v", out)
	}
}

func TestListingsSearchNeighborhoodStub(t *testing.T) {
	s := New(rentcast.NewStub())
	res, out, err := s.listingsSearch(t.Context(), nil, listingsSearchInput{
		Intent:       "rent",
		Neighborhood: "Fremont",
		NewThisWeek:  true,
		PetsWanted:   true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res != nil && res.IsError {
		t.Fatalf("%+v", res)
	}
	got, ok := out.(*rentcast.ListingsSearchResult)
	if !ok || got.Query["days_old"] != "7" || got.Query["neighborhood"] != "Fremont" {
		t.Fatalf("%#v", out)
	}
	if !strings.Contains(got.Note, "RentCast") {
		t.Fatalf("note %q", got.Note)
	}
}
