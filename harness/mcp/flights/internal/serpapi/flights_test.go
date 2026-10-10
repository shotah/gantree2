package serpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestBuildGoogleFlightsURL(t *testing.T) {
	t.Parallel()
	got := BuildGoogleFlightsURL(LinkParams{
		Origin: "sea", Destination: "cdg",
		OutboundDate: "2026-09-01", ReturnDate: "2026-09-10",
		Currency: "USD", Country: "us", Language: "en",
	})
	if !strings.Contains(got, "https://www.google.com/travel/flights?") {
		t.Fatalf("url=%s", got)
	}
	if !strings.Contains(got, "q=") || !strings.Contains(got, "SEA") || !strings.Contains(got, "CDG") {
		t.Fatalf("missing q= search: %s", got)
	}
	if !strings.Contains(got, "through") {
		t.Fatalf("round-trip should include through: %s", got)
	}
	if strings.Contains(got, "#flt=") {
		t.Fatalf("legacy #flt= links no longer work: %s", got)
	}
}

func TestBuildGoogleFlightsURLOneWay(t *testing.T) {
	t.Parallel()
	got := BuildGoogleFlightsURL(LinkParams{
		Origin: "JFK", Destination: "LAX", OutboundDate: "2026-08-15",
	})
	decoded, err := url.QueryUnescape(got)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(decoded, "Flights from JFK to LAX on 2026-08-15") {
		t.Fatalf("url=%s", got)
	}
	if strings.Contains(decoded, "through") {
		t.Fatalf("one-way should not have through: %s", got)
	}
}

func TestParseHelpers(t *testing.T) {
	t.Parallel()
	if v, err := parseTravelClass("business"); err != nil || v != ClassBusiness {
		t.Fatalf("travel class: %v %v", v, err)
	}
	if _, err := parseTravelClass("coach"); err == nil {
		t.Fatal("expected travel class error")
	}
	if v, err := parseStops("nonstop"); err != nil || v != StopsNonstop {
		t.Fatalf("stops: %v %v", v, err)
	}
	if v, err := parseSort("price"); err != nil || v != SortPrice {
		t.Fatalf("sort: %v %v", v, err)
	}
}

func TestSampleDates(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 8, 10, 0, 0, 0, 0, time.UTC)
	got := sampleDates(start, end, 3)
	if len(got) != 3 {
		t.Fatalf("len=%d", len(got))
	}
	if !got[0].Equal(start) || !got[2].Equal(end) {
		t.Fatalf("got %v", got)
	}
}

func writeAccountOK(w http.ResponseWriter) {
	_ = json.NewEncoder(w).Encode(map[string]any{
		"plan_name":           "Free Plan",
		"searches_per_month":  250,
		"plan_searches_left":  249,
		"total_searches_left": 249,
		"this_month_usage":    1,
		"plan_renewal_date":   "2026-09-01",
	})
}

func TestSearchOffersHTTP(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/account.json") {
			writeAccountOK(w)
			return
		}
		if r.URL.Query().Get("engine") != "google_flights" {
			t.Errorf("engine=%s", r.URL.Query().Get("engine"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"search_metadata": map[string]any{
				"google_flights_url": "https://www.google.com/travel/flights?demo=1",
			},
			"search_parameters": map[string]any{"currency": "USD"},
			"best_flights": []map[string]any{
				{
					"price":          199,
					"total_duration": 360,
					"flights": []map[string]any{
						{
							"departure_airport": map[string]any{"id": "JFK", "time": "2026-08-15 08:00"},
							"arrival_airport":   map[string]any{"id": "LAX", "time": "2026-08-15 11:00"},
							"duration":          360,
							"airline":           "JetBlue",
							"flight_number":     "B6101",
							"travel_class":      "Economy",
						},
					},
				},
			},
			"price_insights": map[string]any{
				"lowest_price":        199,
				"price_level":         "low",
				"typical_price_range": []float64{220, 310},
			},
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{APIKey: "test", BaseURL: srv.URL, HTTPClient: srv.Client()}
	res, err := c.SearchOffers(context.Background(), OfferSearchRequest{
		Origin: "JFK", Destination: "LAX", OutboundDate: "2026-08-15",
		SortBy: "price", MaxResults: 5,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Offers) != 1 || res.Offers[0].Price != 199 {
		t.Fatalf("offers=%+v", res.Offers)
	}
	if res.PriceInsights == nil || res.PriceInsights.PriceLevel != "low" {
		t.Fatalf("insights=%+v", res.PriceInsights)
	}
	if !strings.Contains(res.Recommendation, "199") {
		t.Fatalf("recommendation=%q", res.Recommendation)
	}
	if res.Usage == nil || res.Usage.SearchesLeft != 249 {
		t.Fatalf("usage=%+v", res.Usage)
	}
}

func TestSearchAirportsHTTP(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/account.json") {
			writeAccountOK(w)
			return
		}
		if r.URL.Query().Get("engine") != "google_flights_autocomplete" {
			t.Errorf("engine=%s", r.URL.Query().Get("engine"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"suggestions": []map[string]any{
				{
					"name": "Seattle", "type": "city", "id": "/m/0d9jr",
					"airports": []map[string]any{
						{"name": "Seattle-Tacoma International Airport", "id": "SEA", "city": "Seattle"},
					},
				},
			},
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{APIKey: "test", BaseURL: srv.URL, HTTPClient: srv.Client()}
	res, err := c.SearchAirports(context.Background(), "Seattle", "us", "en")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Suggestions) != 1 || len(res.Suggestions[0].Airports) != 1 {
		t.Fatalf("%+v", res)
	}
	if res.Suggestions[0].Airports[0].ID != "SEA" {
		t.Fatalf("%+v", res.Suggestions[0])
	}
}

func TestSearchDatesHTTP(t *testing.T) {
	t.Parallel()
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/account.json") {
			writeAccountOK(w)
			return
		}
		calls++
		price := 100 + calls
		_ = json.NewEncoder(w).Encode(map[string]any{
			"best_flights": []map[string]any{
				{
					"price": price,
					"flights": []map[string]any{
						{
							"departure_airport": map[string]any{"id": "SEA", "time": "08:00"},
							"arrival_airport":   map[string]any{"id": "SFO", "time": "10:00"},
							"airline":           "Alaska",
						},
					},
				},
			},
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{APIKey: "test", BaseURL: srv.URL, HTTPClient: srv.Client()}
	res, err := c.SearchDates(context.Background(), DatesSearchRequest{
		Origin: "SEA", Destination: "SFO",
		StartDate: "2026-09-01", EndDate: "2026-09-05",
		Currency: "USD", Stops: "any", MaxSamples: 3,
	})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatalf("calls=%d", calls)
	}
	if res.TripType != "one_way" {
		t.Fatalf("trip=%s", res.TripType)
	}
	if res.CheapestDate == "" || res.CheapestPrice == 0 {
		t.Fatalf("%+v", res)
	}
}

func TestSearchDatesRoundTripHTTP(t *testing.T) {
	t.Parallel()
	var returnDates []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/account.json") {
			writeAccountOK(w)
			return
		}
		returnDates = append(returnDates, r.URL.Query().Get("return_date"))
		_ = json.NewEncoder(w).Encode(map[string]any{
			"best_flights": []map[string]any{
				{
					"price":          450,
					"total_duration": 800,
					"flights": []map[string]any{
						{
							"departure_airport": map[string]any{"id": "SEA", "time": "08:00"},
							"arrival_airport":   map[string]any{"id": "NRT", "time": "11:00"},
							"airline":           "ANA",
						},
					},
				},
			},
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{APIKey: "test", BaseURL: srv.URL, HTTPClient: srv.Client()}
	res, err := c.SearchDates(context.Background(), DatesSearchRequest{
		Origin: "SEA", Destination: "NRT",
		StartDate: "2026-10-01", EndDate: "2026-10-03",
		StayNights: 7, Currency: "USD", MaxSamples: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.TripType != "round_trip" || res.StayNights != 7 {
		t.Fatalf("%+v", res)
	}
	if len(returnDates) != 2 || returnDates[0] != "2026-10-08" {
		t.Fatalf("return_dates=%v", returnDates)
	}
	if res.CheapestReturn == "" || !strings.Contains(res.Recommendation, "round-trip") {
		t.Fatalf("%+v", res)
	}
}

func TestSummarizeAndRecommendOffers(t *testing.T) {
	t.Parallel()
	res := &OfferSearchResult{
		Currency:         "USD",
		GoogleFlightsURL: "https://www.google.com/travel/flights?x=1",
		PriceInsights: &PriceInsights{
			PriceLevel: "high", TypicalPriceLow: 180, TypicalPriceHigh: 260,
		},
		Offers: []FlightOffer{
			{
				Price: 200, Currency: "USD", Stops: 1, Airlines: []string{"Delta"},
				DepartureAirport: "SEA", ArrivalAirport: "SFO",
				DepartureTime: "08:00", ArrivalTime: "10:30",
				TotalDurationMin: 150, Layovers: []string{"PDX (40m)"},
			},
			{
				Price: 220, Currency: "USD", Stops: 0, Airlines: []string{"Alaska"},
				DepartureAirport: "SEA", ArrivalAirport: "SFO",
				DepartureTime: "09:00", ArrivalTime: "11:00",
				TotalDurationMin: 120,
			},
		},
	}
	for i := range res.Offers {
		res.Offers[i].Summary = summarizeOffer(res.Offers[i])
	}
	if !strings.Contains(res.Offers[0].Summary, "1 stop") || !strings.Contains(res.Offers[0].Summary, "200 USD") {
		t.Fatalf("summary=%q", res.Offers[0].Summary)
	}
	rec := recommendOffers(res)
	if !strings.Contains(rec, "Alaska") || !strings.Contains(rec, "expensive") {
		t.Fatalf("recommendation=%q", rec)
	}
}

func TestGetJSONErrors(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"Invalid API key"}`))
	}))
	t.Cleanup(srv.Close)

	c := &Client{APIKey: "bad", BaseURL: srv.URL, HTTPClient: srv.Client()}
	err := c.GetJSON(context.Background(), nil, &map[string]any{})
	if err == nil || !strings.Contains(err.Error(), "400") {
		t.Fatalf("err=%v", err)
	}
}

func TestValidateOfferRequest(t *testing.T) {
	t.Parallel()
	if err := validateOfferRequest(OfferSearchRequest{}); err == nil {
		t.Fatal("expected error")
	}
	if err := validateOfferRequest(OfferSearchRequest{
		Origin: "SEA", Destination: "CDG", OutboundDate: "not-a-date",
	}); err == nil {
		t.Fatal("expected date error")
	}
}

func TestAccountHTTP(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/account.json") {
			t.Errorf("path=%s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"plan_name":           "Free Plan",
			"searches_per_month":  250,
			"plan_searches_left":  200,
			"total_searches_left": 200,
			"this_month_usage":    50,
			"plan_renewal_date":   "2026-09-01",
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{APIKey: "test", BaseURL: srv.URL, HTTPClient: srv.Client()}
	u, err := c.Account(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if u.SearchesUsed != 50 || u.SearchesLeft != 200 || u.PlanRenewalDate != "2026-09-01" {
		t.Fatalf("%+v", u)
	}
}

func TestNewFromEnv(t *testing.T) {
	t.Setenv("SERPAPI_API_KEY", "")
	if _, err := NewFromEnv(); err == nil {
		t.Fatal("expected missing key error")
	}
	t.Setenv("SERPAPI_API_KEY", "k")
	t.Setenv("SERPAPI_BASE_URL", "http://example.test/")
	c, err := NewFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if c.BaseURL != "http://example.test" {
		t.Fatalf("base=%s", c.BaseURL)
	}
}
