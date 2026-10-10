package rentcast

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestNormalizeIntent(t *testing.T) {
	cases := map[string]string{
		"rent":     IntentRent,
		"Rental":   IntentRent,
		"for-rent": IntentRent,
		"lease":    IntentRent,
		"buy":      IntentBuy,
		"purchase": IntentBuy,
		"for_sale": IntentBuy,
		"Sale":     IntentBuy,
	}
	for in, want := range cases {
		got, err := NormalizeIntent(in)
		if err != nil {
			t.Fatalf("NormalizeIntent(%q): %v", in, err)
		}
		if got != want {
			t.Fatalf("NormalizeIntent(%q)=%q want %q", in, got, want)
		}
	}
	if _, err := NormalizeIntent(""); err != nil {
		t.Fatalf("empty intent should default to rent: %v", err)
	}
	if got, _ := NormalizeIntent(""); got != IntentRent {
		t.Fatalf("empty intent=%q want rent", got)
	}
	if _, err := NormalizeIntent("maybe"); err == nil {
		t.Fatal("expected unknown intent error")
	}
}

func TestNormalizePropertyType(t *testing.T) {
	cases := map[string]string{
		"":                "",
		"apartment":       "Apartment",
		"Apartments":      "Apartment",
		"house":           "Single Family",
		"single_family":   "Single Family",
		"condo":           "Condo",
		"townhome":        "Townhouse",
		"manufactured":    "Manufactured",
		"duplex":          "Multi-Family",
		"Single Family":   "Single Family",
		"apartment|condo": "Apartment|Condo",
		"house,condo":     "Single Family|Condo",
		"house, condo":    "Single Family|Condo",
		"land":            "Land",
		"lot":             "Land",
	}
	for in, want := range cases {
		if got := NormalizePropertyType(in); got != want {
			t.Fatalf("NormalizePropertyType(%q)=%q want %q", in, got, want)
		}
	}
}

func TestNewFromEnvMissingKey(t *testing.T) {
	t.Setenv("RENTCAST_API_KEY", "")
	if _, err := NewFromEnv(); err == nil {
		t.Fatal("expected error for missing key")
	}
}

func TestNewFromEnvOK(t *testing.T) {
	t.Setenv("RENTCAST_API_KEY", "test-key")
	t.Setenv("RENTCAST_BASE_URL", "https://example.test/v1/")
	c, err := NewFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if c.APIKey != "test-key" {
		t.Fatalf("key %q", c.APIKey)
	}
	if c.BaseURL != "https://example.test/v1" {
		t.Fatalf("base %q", c.BaseURL)
	}
}

func TestStubMethods(t *testing.T) {
	s := NewStub()
	ctx := t.Context()
	if _, err := s.SearchListings(ctx, ListingsSearchRequest{Intent: IntentRent, City: "Seattle", State: "WA"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetListing(ctx, "abc", IntentRent); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RentEstimate(ctx, RentEstimateRequest{Address: "1 Main St, Seattle, WA 98101"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.MarketStats(ctx, "98101"); err != nil {
		t.Fatal(err)
	}
}

func TestFormatPriceRange(t *testing.T) {
	cases := []struct {
		min, max int
		want     string
	}{
		{0, 0, ""},
		{1200, 0, "1200:*"},
		{0, 2500, "*:2500"},
		{1200, 2500, "1200:2500"},
	}
	for _, tc := range cases {
		if got := formatPriceRange(tc.min, tc.max); got != tc.want {
			t.Fatalf("formatPriceRange(%d,%d)=%q want %q", tc.min, tc.max, got, tc.want)
		}
	}
}

func TestValidateSearchRequest(t *testing.T) {
	if err := validateSearchRequest(ListingsSearchRequest{}); err == nil {
		t.Fatal("expected location error")
	}
	if err := validateSearchRequest(ListingsSearchRequest{City: "Seattle", State: "WA"}); err != nil {
		t.Fatal(err)
	}
	if err := validateSearchRequest(ListingsSearchRequest{Intent: IntentRent, City: "Seattle", State: "WA"}); err != nil {
		t.Fatal(err)
	}
	if err := validateSearchRequest(ListingsSearchRequest{Intent: IntentBuy, ZipCode: "98101"}); err != nil {
		t.Fatal(err)
	}
	if err := validateSearchRequest(ListingsSearchRequest{Intent: IntentRent, Latitude: 47.6, Longitude: -122.3}); err != nil {
		t.Fatal(err)
	}
	if err := validateSearchRequest(ListingsSearchRequest{Intent: IntentRent, ZipCode: "98101", Radius: 200}); err == nil {
		t.Fatal("expected radius error")
	}
	if err := validateSearchRequest(ListingsSearchRequest{Intent: IntentRent, City: "Seattle", State: "WA", PropertyType: "land"}); err == nil {
		t.Fatal("expected land rejected on rent")
	}
	if err := validateSearchRequest(ListingsSearchRequest{Intent: IntentBuy, City: "Seattle", State: "WA", PropertyType: "land"}); err != nil {
		t.Fatal(err)
	}
}

func TestNormalizePage(t *testing.T) {
	lim, off := normalizePage(0, -1)
	if lim != defaultLimit || off != 0 {
		t.Fatalf("got %d %d", lim, off)
	}
	lim, off = normalizePage(500, 5)
	if lim != maxAgentLimit || off != 5 {
		t.Fatalf("got %d %d", lim, off)
	}
}

func TestSearchListingsHTTP(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/listings/rental/long-term" {
			t.Fatalf("path %s", r.URL.Path)
		}
		if r.Header.Get("X-Api-Key") != "test-key" {
			t.Fatalf("missing api key")
		}
		q := r.URL.Query()
		if q.Get("city") != "Seattle" || q.Get("state") != "WA" {
			t.Fatalf("loc %v", q)
		}
		if q.Get("propertyType") != "Apartment" {
			t.Fatalf("propertyType %q", q.Get("propertyType"))
		}
		if q.Get("price") != "1500:2500" {
			t.Fatalf("price %q", q.Get("price"))
		}
		if q.Get("daysOld") != "7" {
			t.Fatalf("daysOld %q", q.Get("daysOld"))
		}
		if q.Get("limit") != "10" {
			t.Fatalf("limit %q", q.Get("limit"))
		}
		if q.Get("includeTotalCount") != "true" {
			t.Fatal("expected includeTotalCount")
		}
		w.Header().Set("X-Total-Count", "42")
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{
				"id":               "123-Pine-St,-Seattle,-WA-98101",
				"formattedAddress": "123 Pine St, Seattle, WA 98101",
				"city":             "Seattle",
				"state":            "WA",
				"zipCode":          "98101",
				"propertyType":     "Apartment",
				"bedrooms":         1,
				"bathrooms":        1,
				"squareFootage":    650,
				"price":            2100,
				"status":           "Active",
				"daysOnMarket":     4,
				"listedDate":       "2026-07-28T00:00:00.000Z",
				"latitude":         47.61,
				"longitude":        -122.33,
				"listingAgent": map[string]any{
					"name":  "Alex Agent",
					"phone": "2065550100",
					"email": "alex@example.com",
				},
			},
			{
				"id":               "456-Oak-Ave,-Seattle,-WA-98102",
				"formattedAddress": "456 Oak Ave, Seattle, WA 98102",
				"city":             "Seattle",
				"state":            "WA",
				"zipCode":          "98102",
				"propertyType":     "Apartment",
				"bedrooms":         0,
				"bathrooms":        1,
				"price":            1800,
				"status":           "Active",
				"daysOnMarket":     12,
				"listingOffice": map[string]any{
					"name":    "Harbor Realty",
					"website": "https://harbor.example.com/listing/456",
				},
			},
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{APIKey: "test-key", BaseURL: srv.URL, HTTPClient: srv.Client()}
	res, err := c.SearchListings(t.Context(), ListingsSearchRequest{
		Intent:       IntentRent,
		City:         "Seattle",
		State:        "wa",
		PropertyType: "apartment",
		PriceMin:     1500,
		PriceMax:     2500,
		NewThisWeek:  true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Count != 2 || res.Total != 42 || res.Limit != 10 {
		t.Fatalf("page %+v", res)
	}
	if res.Intent != IntentRent || res.Query["intent"] != IntentRent {
		t.Fatalf("intent %#v", res)
	}
	if res.Query["state"] != "WA" || res.Query["property_type"] != "Apartment" {
		t.Fatalf("query %#v", res.Query)
	}
	if res.Query["days_old"] != "7" || res.Query["new_this_week"] != true {
		t.Fatalf("query %#v", res.Query)
	}
	if res.Summary == "" || !strings.Contains(res.Summary, "Top picks") {
		t.Fatalf("summary %q", res.Summary)
	}
	if !strings.Contains(res.Summary, "new this week") {
		t.Fatalf("summary missing fresh note: %q", res.Summary)
	}
	if res.Listings[0].Agent == nil || res.Listings[0].Agent.Phone != "2065550100" {
		t.Fatalf("agent %#v", res.Listings[0].Agent)
	}
	if !strings.Contains(res.Listings[0].SearchURL, "google.com/search") || !strings.Contains(res.Listings[0].SearchURL, "rental") {
		t.Fatalf("search_url %q", res.Listings[0].SearchURL)
	}
	if res.Listings[1].Office == nil || res.Listings[1].Office.Website != "https://harbor.example.com/listing/456" {
		t.Fatalf("office website %#v", res.Listings[1].Office)
	}
	if res.Listings[1].Bedrooms != 0 {
		t.Fatalf("studio bedrooms=%v", res.Listings[1].Bedrooms)
	}
}

func TestSearchListingsNeighborhoodHTTP(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("latitude") == "" || q.Get("longitude") == "" || q.Get("radius") == "" {
			t.Fatalf("expected lat/lng/radius, got %v", q)
		}
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{
				"id": "a", "formattedAddress": "1 Pike, Seattle, WA 98102",
				"city": "Seattle", "state": "WA", "zipCode": "98102",
				"bedrooms": 1, "bathrooms": 1, "price": 2000, "daysOnMarket": 2,
			},
			{
				"id": "b", "formattedAddress": "9 Main, Seattle, WA 98101",
				"city": "Seattle", "state": "WA", "zipCode": "98101",
				"bedrooms": 1, "bathrooms": 1, "price": 1900, "daysOnMarket": 3,
			},
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()}
	res, err := c.SearchListings(t.Context(), ListingsSearchRequest{Intent: IntentRent, Neighborhood: "Capitol Hill"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Query["neighborhood"] != "Capitol Hill" {
		t.Fatalf("%#v", res.Query)
	}
	// Radius search may return nearby zips; client filter keeps neighborhood zips when multi.
	if res.Count < 1 {
		t.Fatalf("%+v", res)
	}
}

func TestSearchListingsDefaultsToRentalPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/listings/rental/long-term" {
			t.Fatalf("empty intent must hit for-rent catalog, got %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{
				"id": "r1", "formattedAddress": "1 Pine, Seattle, WA 98101",
				"city": "Seattle", "state": "WA", "price": 2000,
				"mlsName": "NWMLS", "mlsNumber": "123",
				"listingAgent": map[string]any{"name": "Pat", "phone": "2065550199", "email": "pat@ex.com"},
			},
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()}
	res, err := c.SearchListings(t.Context(), ListingsSearchRequest{City: "Seattle", State: "WA"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Intent != IntentRent || res.Listings[0].Intent != IntentRent {
		t.Fatalf("%+v", res)
	}
	if res.Listings[0].MLSName != "NWMLS" || res.Listings[0].MLSNumber != "123" {
		t.Fatalf("mls %+v", res.Listings[0])
	}
	if res.Listings[0].Agent == nil || res.Listings[0].Agent.Email != "pat@ex.com" {
		t.Fatalf("agent %+v", res.Listings[0].Agent)
	}
}

func TestSearchListingsValidation(t *testing.T) {
	c := &Client{APIKey: "k", BaseURL: "http://127.0.0.1:1"}
	if _, err := c.SearchListings(t.Context(), ListingsSearchRequest{}); err == nil {
		t.Fatal("expected validation error")
	}
}

func TestGetListingHTTP(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/listings/rental/long-term/") {
			t.Fatalf("path %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":               "abc",
			"formattedAddress": "1 Main St, Portland, OR 97201",
			"city":             "Portland",
			"state":            "OR",
			"zipCode":          "97201",
			"propertyType":     "Condo",
			"bedrooms":         2,
			"bathrooms":        2,
			"price":            2400,
			"status":           "Active",
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{
		APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client(),
		Usage: NewUsageTrackerForTest(filepath.Join(t.TempDir(), "usage.json"), 50),
	}
	listing, err := c.GetListing(t.Context(), "abc", IntentRent)
	if err != nil {
		t.Fatal(err)
	}
	if listing.City != "Portland" || listing.Price != 2400 {
		t.Fatalf("%+v", listing)
	}
	if listing.Usage == nil || listing.Usage.RequestsUsed != 1 {
		t.Fatalf("usage %+v", listing.Usage)
	}
}

func TestSearchSaleListingsHTTP(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/listings/sale" {
			t.Fatalf("path %s", r.URL.Path)
		}
		if r.URL.Query().Get("propertyType") != "Condo" {
			t.Fatalf("propertyType %q", r.URL.Query().Get("propertyType"))
		}
		if r.URL.Query().Get("price") != "*:500000" {
			t.Fatalf("price %q", r.URL.Query().Get("price"))
		}
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{
				"id":               "789-Pine-St,-Seattle,-WA-98101",
				"formattedAddress": "789 Pine St, Seattle, WA 98101",
				"city":             "Seattle",
				"state":            "WA",
				"zipCode":          "98101",
				"propertyType":     "Condo",
				"bedrooms":         2,
				"bathrooms":        2,
				"price":            475000,
				"status":           "Active",
				"daysOnMarket":     6,
			},
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()}
	res, err := c.SearchListings(t.Context(), ListingsSearchRequest{
		Intent: "purchase", City: "Seattle", State: "WA", PropertyType: "condo", PriceMax: 500000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Intent != IntentBuy || res.Count != 1 || res.Listings[0].Price != 475000 {
		t.Fatalf("%+v", res)
	}
	if res.Listings[0].Intent != IntentBuy {
		t.Fatalf("listing intent %q", res.Listings[0].Intent)
	}
	if !strings.Contains(res.Summary, "$475000") || strings.Contains(res.Summary, "/mo") {
		t.Fatalf("sale summary should be purchase price, got %q", res.Summary)
	}
	if !strings.Contains(res.Note, "offers") {
		t.Fatalf("note %q", res.Note)
	}
	if !strings.Contains(res.Listings[0].SearchURL, "for+sale") && !strings.Contains(res.Listings[0].SearchURL, "for sale") {
		t.Fatalf("search_url %q", res.Listings[0].SearchURL)
	}
}

func TestGetListingSaleHTTP(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/listings/sale/sale-id" {
			t.Fatalf("path %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":               "sale-id",
			"formattedAddress": "9 Elm St, Denver, CO 80202",
			"city":             "Denver",
			"state":            "CO",
			"price":            610000,
			"propertyType":     "Single Family",
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()}
	listing, err := c.GetListing(t.Context(), "sale-id", IntentBuy)
	if err != nil {
		t.Fatal(err)
	}
	if listing.Intent != IntentBuy || listing.Price != 610000 {
		t.Fatalf("%+v", listing)
	}
	if !strings.Contains(listing.SearchURL, "for+sale") && !strings.Contains(listing.SearchURL, "for sale") {
		t.Fatalf("search_url %q", listing.SearchURL)
	}
}

func TestGetListingRequiresID(t *testing.T) {
	c := &Client{APIKey: "k"}
	if _, err := c.GetListing(t.Context(), "  ", IntentRent); err == nil {
		t.Fatal("expected error")
	}
}

func TestRentEstimateHTTP(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/avm/rent/long-term" {
			t.Fatalf("path %s", r.URL.Path)
		}
		if r.URL.Query().Get("propertyType") != "Single Family" {
			t.Fatalf("propertyType %q", r.URL.Query().Get("propertyType"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"rent":          2750,
			"rentRangeLow":  2500,
			"rentRangeHigh": 3000,
			"subjectProperty": map[string]any{
				"formattedAddress": "9 Elm St, Denver, CO 80202",
				"propertyType":     "Single Family",
				"bedrooms":         3,
				"bathrooms":        2,
			},
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()}
	res, err := c.RentEstimate(t.Context(), RentEstimateRequest{
		Address:      "9 Elm St, Denver, CO 80202",
		PropertyType: "house",
		Bedrooms:     "3",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.RentEstimate != 2750 || res.Address != "9 Elm St, Denver, CO 80202" {
		t.Fatalf("%+v", res)
	}
}

func TestMarketStatsHTTP(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/markets" {
			t.Fatalf("path %s", r.URL.Path)
		}
		q := r.URL.Query()
		if q.Get("zipCode") != "98101" || q.Get("dataType") != "Rental" {
			t.Fatalf("query %v", q)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"zipCode": "98101",
			"rentalData": map[string]any{
				"averageRent":         2600,
				"medianRent":          2450,
				"minRent":             1200,
				"maxRent":             5000,
				"totalListings":       120,
				"newListings":         18,
				"averageDaysOnMarket": 22.5,
				"medianDaysOnMarket":  10,
				"dataByPropertyType": []map[string]any{
					{"propertyType": "Apartment", "averageRent": 2300, "medianRent": 2200, "totalListings": 80},
				},
			},
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client()}
	res, err := c.MarketStats(t.Context(), "98101")
	if err != nil {
		t.Fatal(err)
	}
	if res.MedianRent != 2450 || len(res.ByPropertyType) != 1 {
		t.Fatalf("%+v", res)
	}
}

func TestHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"message":"nope"}`, http.StatusUnauthorized)
	}))
	t.Cleanup(srv.Close)

	c := &Client{APIKey: "bad", BaseURL: srv.URL, HTTPClient: srv.Client()}
	_, err := c.MarketStats(t.Context(), "98101")
	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("err=%v", err)
	}
}

func TestSummarizeEmpty(t *testing.T) {
	s := summarizeListings(nil, 0, 10, 0, IntentRent)
	if !strings.Contains(s, "No listings") {
		t.Fatalf("%q", s)
	}
}

func TestMarketStatsHardCapDoesNotHitNetwork(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		http.Error(w, "should not be called", http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)

	usage := NewUsageTrackerForTest(filepath.Join(t.TempDir(), "usage.json"), 50)
	for range 50 {
		usage.RecordSuccess()
	}
	c := &Client{APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client(), Usage: usage}
	_, err := c.MarketStats(t.Context(), "98101")
	if !errors.Is(err, ErrQuotaExhausted) {
		t.Fatalf("err=%v", err)
	}
	if hits.Load() != 0 {
		t.Fatalf("hard cap leaked %d HTTP calls", hits.Load())
	}
}

func TestMarketStatsSoftCapRequiresConfirm(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		_ = json.NewEncoder(w).Encode(map[string]any{"zipCode": "98101"})
	}))
	t.Cleanup(srv.Close)

	usage := NewUsageTrackerForTest(filepath.Join(t.TempDir(), "usage.json"), 50)
	for range 40 {
		usage.RecordSuccess()
	}
	c := &Client{APIKey: "k", BaseURL: srv.URL, HTTPClient: srv.Client(), Usage: usage}
	_, err := c.MarketStats(t.Context(), "98101")
	if !errors.Is(err, ErrQuotaConfirmNeeded) {
		t.Fatalf("err=%v", err)
	}
	if hits.Load() != 0 {
		t.Fatalf("soft cap leaked %d HTTP calls", hits.Load())
	}

	_, err = c.MarketStats(WithConfirmSpend(t.Context(), true), "98101")
	if err != nil {
		t.Fatal(err)
	}
	if hits.Load() != 1 {
		t.Fatalf("confirm should send exactly 1 request, got %d", hits.Load())
	}
	if usage.Snapshot().RequestsUsed != 41 {
		t.Fatalf("usage %+v", usage.Snapshot())
	}
}

func TestGoogleListingSearchURL(t *testing.T) {
	u := googleListingSearchURL("902 N 86th St, Seattle, WA 98103", IntentRent)
	if !strings.Contains(u, "google.com/search?q=") || !strings.Contains(u, "rental") {
		t.Fatalf("%q", u)
	}
	buy := googleListingSearchURL("902 N 86th St, Seattle, WA 98103", IntentBuy)
	if !strings.Contains(buy, "for+sale") && !strings.Contains(buy, "for sale") {
		t.Fatalf("buy url %q", buy)
	}
}
