package rentcast

import (
	"strings"
	"testing"
)

func TestResolveAreasCapitolHill(t *testing.T) {
	res, err := ResolveAreas(AreaResolveRequest{Neighborhood: "cap hill"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Count != 1 || res.Areas[0].Name != "Capitol Hill" {
		t.Fatalf("%+v", res)
	}
	if len(res.Areas[0].Zips) < 1 || res.Areas[0].Latitude == 0 {
		t.Fatalf("expected zips+coords: %+v", res.Areas[0])
	}
}

func TestResolveAreasListSeattle(t *testing.T) {
	res, err := ResolveAreas(AreaResolveRequest{City: "Seattle", State: "WA", ListAll: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Count < 10 {
		t.Fatalf("expected many Seattle presets, got %d", res.Count)
	}
}

func TestResolveAreasUnknown(t *testing.T) {
	_, err := ResolveAreas(AreaResolveRequest{Neighborhood: "Atlantis"})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParseZipList(t *testing.T) {
	got := ParseZipList("98102, 98122|98102;98118-1234")
	if len(got) != 3 {
		t.Fatalf("%v", got)
	}
	if got[0] != "98102" || got[2] != "98118" {
		t.Fatalf("%v", got)
	}
}

func TestExpandNewThisWeekAndNeighborhood(t *testing.T) {
	req, notes, err := ExpandSearchRequest(ListingsSearchRequest{
		Neighborhood: "Ballard",
		NewThisWeek:  true,
		PetsWanted:   true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if req.DaysOld != "7" {
		t.Fatalf("days_old=%q notes=%v", req.DaysOld, notes)
	}
	if req.Latitude == 0 || req.City != "Seattle" || req.State != "WA" {
		t.Fatalf("%+v", req)
	}
	joined := strings.Join(notes, " ")
	if !strings.Contains(joined, "pet") && !strings.Contains(joined, "RentCast") {
		t.Fatalf("expected amenity note: %v", notes)
	}
}

func TestExpandZipCodes(t *testing.T) {
	req, notes, err := ExpandSearchRequest(ListingsSearchRequest{
		City:     "Seattle",
		State:    "WA",
		ZipCodes: "98102,98122",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(req.ZipFilter) != 2 || req.ZipCode != "" {
		t.Fatalf("%+v", req)
	}
	if !strings.Contains(strings.Join(notes, " "), "one city+state") {
		t.Fatalf("notes %v", notes)
	}
}

func TestExpandMultiNeighborhoodOneCall(t *testing.T) {
	req, notes, err := ExpandSearchRequest(ListingsSearchRequest{
		Neighborhood: "Ballard, Fremont, Wallingford",
		PriceMax:     2500,
	})
	if err != nil {
		t.Fatal(err)
	}
	if req.City != "Seattle" || req.State != "WA" {
		t.Fatalf("%+v", req)
	}
	if req.Latitude != 0 || req.Longitude != 0 {
		t.Fatalf("multi-neighborhood should not pin single geo: %+v", req)
	}
	if len(req.ZipFilter) < 2 || req.ZipCode != "" {
		t.Fatalf("want multi zip filter, one city call: %+v", req)
	}
	joined := strings.Join(notes, " ")
	if !strings.Contains(joined, "neighborhoods") || !strings.Contains(joined, "one") {
		t.Fatalf("notes %v", notes)
	}
}

func TestFilterListingsByZips(t *testing.T) {
	in := []Listing{
		{ID: "a", ZipCode: "98102"},
		{ID: "b", ZipCode: "98101"},
		{ID: "c", ZipCode: "98122"},
	}
	got := filterListingsByZips(in, []string{"98102", "98122"})
	if len(got) != 2 {
		t.Fatalf("%+v", got)
	}
}
