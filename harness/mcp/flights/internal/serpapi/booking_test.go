package serpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestGetBookingOptionsHTTP(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/account.json") {
			writeAccountOK(w)
			return
		}
		if r.URL.Query().Get("booking_token") != "tok123" {
			t.Errorf("booking_token=%s", r.URL.Query().Get("booking_token"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"search_parameters": map[string]any{"currency": "USD"},
			"booking_options": []map[string]any{
				{
					"together": map[string]any{
						"book_with":    "Alaska Airlines",
						"airline":      true,
						"price":        220,
						"option_title": "Main Cabin",
						"marketed_as":  []string{"AS 123"},
						"booking_request": map[string]any{
							"url":       "https://www.google.com/travel/clk/f",
							"post_data": "u=abc",
						},
					},
				},
			},
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{APIKey: "test", BaseURL: srv.URL, HTTPClient: srv.Client()}
	res, err := c.GetBookingOptions(context.Background(), BookingOptionsRequest{
		BookingToken: "tok123", Currency: "USD", Country: "us", Language: "en",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Options) != 1 {
		t.Fatalf("%+v", res)
	}
	opt := res.Options[0]
	if opt.BookWith != "Alaska Airlines" || opt.Booking == nil || opt.Booking.Method != http.MethodPost {
		t.Fatalf("%+v", opt)
	}
	if !strings.Contains(res.Recommendation, "checkout") {
		t.Fatalf("recommendation=%q", res.Recommendation)
	}
}

func TestSelectDepartureHTTP(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/account.json") {
			writeAccountOK(w)
			return
		}
		if r.URL.Query().Get("departure_token") == "" {
			t.Error("missing departure_token")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"best_flights": []map[string]any{
				{
					"price":          500,
					"booking_token":  "book-me",
					"total_duration": 400,
					"flights": []map[string]any{
						{
							"departure_airport": map[string]any{"id": "NRT", "time": "10:00"},
							"arrival_airport":   map[string]any{"id": "SEA", "time": "14:00"},
							"airline":           "ANA",
						},
					},
				},
			},
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{APIKey: "test", BaseURL: srv.URL, HTTPClient: srv.Client()}
	res, err := c.SelectDeparture(context.Background(), "dep-tok", "USD", "us", "en")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Offers) != 1 || res.Offers[0].BookingToken != "book-me" {
		t.Fatalf("%+v", res)
	}
	if !strings.Contains(res.Recommendation, "booking_options_get") {
		t.Fatalf("recommendation=%q", res.Recommendation)
	}
}

func TestGetBookingOptionsRequiresToken(t *testing.T) {
	t.Parallel()
	c := &Client{APIKey: "test"}
	if _, err := c.GetBookingOptions(context.Background(), BookingOptionsRequest{}); err == nil {
		t.Fatal("expected error")
	}
}

func TestGetBookingOptionsRefundableOnly(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/account.json") {
			writeAccountOK(w)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"search_parameters": map[string]any{"currency": "USD"},
			"booking_options": []map[string]any{
				{
					"together": map[string]any{
						"book_with":    "Airline A",
						"price":        100,
						"option_title": "Basic Economy",
						"extensions":   []string{"No refunds"},
						"booking_request": map[string]any{
							"url": "https://example.com/a",
						},
					},
				},
				{
					"together": map[string]any{
						"book_with":    "Airline B",
						"price":        180,
						"option_title": "Refundable Economy",
						"extensions":   []string{"Refundable"},
						"booking_request": map[string]any{
							"url": "https://example.com/b",
						},
					},
				},
			},
		})
	}))
	t.Cleanup(srv.Close)

	c := &Client{APIKey: "test", BaseURL: srv.URL, HTTPClient: srv.Client()}
	res, err := c.GetBookingOptions(context.Background(), BookingOptionsRequest{
		BookingToken: "tok", RefundableOnly: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Options) != 1 || res.Options[0].Refundable != RefundableYes {
		t.Fatalf("%+v", res.Options)
	}
	if !strings.Contains(res.Recommendation, "refundable") {
		t.Fatalf("recommendation=%q", res.Recommendation)
	}
}

func TestSampleDateStayPlans(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 8, 14, 0, 0, 0, 0, time.UTC)
	plans := sampleDateStayPlans(start, end, 4, 7, 7)
	if len(plans) == 0 || len(plans) > 7 {
		t.Fatalf("len=%d", len(plans))
	}
	seenStay := map[int]bool{}
	for _, p := range plans {
		if p.StayNights < 4 || p.StayNights > 7 {
			t.Fatalf("stay=%d", p.StayNights)
		}
		seenStay[p.StayNights] = true
	}
	if len(seenStay) < 2 {
		t.Fatalf("expected multiple stay lengths, got %v", seenStay)
	}
}

func TestNormalizePriceHistory(t *testing.T) {
	t.Parallel()
	got := normalizePriceHistory([][]float64{{1691013600, 575}, {1691100000, 600}, {1}})
	if len(got) != 2 || got[0].Price != 575 {
		t.Fatalf("%+v", got)
	}
}
