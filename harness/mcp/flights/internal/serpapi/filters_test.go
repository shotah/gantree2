package serpapi

import (
	"strings"
	"testing"
)

func TestResolveAirlineListPresets(t *testing.T) {
	t.Parallel()
	got, err := resolveAirlineList("alaska_partners")
	if err != nil {
		t.Fatal(err)
	}
	if got != "AS,ONEWORLD" {
		t.Fatalf("got %q", got)
	}
	got, err = resolveAirlineList("delta,UA")
	if err != nil {
		t.Fatal(err)
	}
	if got != "DL,SKYTEAM,UA" {
		t.Fatalf("got %q", got)
	}
}

func TestApplyAirlineParamsExclusive(t *testing.T) {
	t.Parallel()
	if _, _, err := applyAirlineParams("AS", "DL"); err == nil {
		t.Fatal("expected exclusive error")
	}
	inc, exc, err := applyAirlineParams("ONEWORLD", "")
	if err != nil || inc != "ONEWORLD" || exc != "" {
		t.Fatalf("%q %q %v", inc, exc, err)
	}
}

func TestMarketingCodeFromFlightNumber(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"B6101":   "B6",
		"AS 123":  "AS",
		"DL123":   "DL",
		"9E4800":  "9E",
		"":        "",
		"JetBlue": "",
	}
	for in, want := range cases {
		if got := marketingCodeFromFlightNumber(in); got != want {
			t.Fatalf("%q → %q want %q", in, got, want)
		}
	}
}

func TestClassifyFlyAmerica(t *testing.T) {
	t.Parallel()
	ok := FlightOffer{Flights: []FlightSegment{
		{Airline: "Delta", FlightNumber: "DL100"},
		{Airline: "Delta", FlightNumber: "DL200"},
	}}
	status, _, codes := classifyFlyAmerica(ok)
	if status != FlyAmericaOK || len(codes) != 1 || codes[0] != "DL" {
		t.Fatalf("%s %v", status, codes)
	}

	foreign := FlightOffer{Flights: []FlightSegment{
		{Airline: "Air France", FlightNumber: "AF83"},
	}}
	status, _, _ = classifyFlyAmerica(foreign)
	if status != FlyAmericaForeign {
		t.Fatalf("got %s", status)
	}
}

func TestApplyFlyAmericaFilter(t *testing.T) {
	t.Parallel()
	out := &OfferSearchResult{
		Destination: "CDG",
		Offers: []FlightOffer{
			{Price: 500, Flights: []FlightSegment{{FlightNumber: "DL1"}}},
			{Price: 400, Flights: []FlightSegment{{FlightNumber: "AF1"}}},
		},
	}
	if err := applyFlyAmerica(out, "filter", "civilian"); err != nil {
		t.Fatal(err)
	}
	if len(out.Offers) != 1 || out.Offers[0].FlyAmericaStatus != FlyAmericaOK {
		t.Fatalf("%+v", out.Offers)
	}
	if out.ComplianceNote == "" || out.OpenSkiesHint == "" {
		t.Fatalf("missing notes: %+v", out)
	}
	if !strings.Contains(out.OpenSkiesHint, "Open Skies") {
		t.Fatalf("hint=%q", out.OpenSkiesHint)
	}
}

func TestDetectRefundable(t *testing.T) {
	t.Parallel()
	if got := detectRefundable("Basic", []string{"No refunds"}); got != RefundableNo {
		t.Fatalf("%s", got)
	}
	if got := detectRefundable("Refundable Economy", nil); got != RefundableYes {
		t.Fatalf("%s", got)
	}
	if got := detectRefundable("Main Cabin", []string{"Free seat"}); got != RefundableUnknown {
		t.Fatalf("%s", got)
	}
}

func TestOfferParamsAirlinesAndExcludeBasic(t *testing.T) {
	t.Parallel()
	params, err := offerParams(OfferSearchRequest{
		Origin: "SEA", Destination: "SFO", OutboundDate: "2026-09-01",
		IncludeAirlines: "alaska_partners", ExcludeBasic: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if params.Get("include_airlines") != "AS,ONEWORLD" {
		t.Fatalf("include=%q", params.Get("include_airlines"))
	}
	if params.Get("exclude_basic") != "true" {
		t.Fatalf("exclude_basic=%q", params.Get("exclude_basic"))
	}
}
