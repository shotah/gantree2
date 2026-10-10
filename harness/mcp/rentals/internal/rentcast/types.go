package rentcast

// IntentRent / IntentBuy are the only accepted listings_search intents.
const (
	IntentRent = "rent"
	IntentBuy  = "buy"
)

// ListingsSearchRequest is the MCP-facing search input (mapped to RentCast query params).
type ListingsSearchRequest struct {
	Intent        string // empty defaults to rent; buy selects /listings/sale
	City          string
	State         string
	ZipCode       string
	ZipCodes      string // CSV / pipe list — expanded into ZipFilter
	Neighborhood  string // local preset name (e.g. "Capitol Hill")
	Address       string
	Latitude      float64
	Longitude     float64
	Radius        float64
	PropertyType  string
	Bedrooms      string
	Bathrooms     string
	SquareFootage string
	PriceMin      int
	PriceMax      int
	Status        string
	DaysOld       string // RentCast daysOld (single = max; ranges like "*:7" ok)
	DaysOldMax    int    // ergonomic max age in days
	NewThisWeek   bool   // shorthand → days_old_max=7
	PetsWanted    bool   // not filterable upstream — soft note only
	ParkingWanted bool
	LaundryWanted bool
	Limit         int
	Offset        int

	// ZipFilter is set by ExpandSearchRequest for optional client-side zip narrowing.
	ZipFilter []string
}

// ListingContact is agent/office handoff info from the listing record.
type ListingContact struct {
	Name    string `json:"name,omitempty"`
	Phone   string `json:"phone,omitempty"`
	Email   string `json:"email,omitempty"`
	Website string `json:"website,omitempty"`
}

// Listing is a lean listing summary for agents.
type Listing struct {
	ID               string          `json:"id"`
	Intent           string          `json:"intent,omitempty"` // rent → /listings/rental/long-term; buy → /listings/sale
	FormattedAddress string          `json:"formatted_address,omitempty"`
	City             string          `json:"city,omitempty"`
	State            string          `json:"state,omitempty"`
	ZipCode          string          `json:"zip_code,omitempty"`
	PropertyType     string          `json:"property_type,omitempty"`
	ListingType      string          `json:"listing_type,omitempty"`
	Bedrooms         float64         `json:"bedrooms"`
	Bathrooms        float64         `json:"bathrooms"`
	SquareFootage    float64         `json:"square_footage,omitempty"`
	Price            float64         `json:"price,omitempty"`
	Status           string          `json:"status,omitempty"`
	DaysOnMarket     int             `json:"days_on_market,omitempty"`
	ListedDate       string          `json:"listed_date,omitempty"`
	MLSName          string          `json:"mls_name,omitempty"`
	MLSNumber        string          `json:"mls_number,omitempty"`
	SearchURL        string          `json:"search_url,omitempty"` // Google address fallback; RentCast has no portal listing URL
	Latitude         float64         `json:"latitude,omitempty"`
	Longitude        float64         `json:"longitude,omitempty"`
	Agent            *ListingContact `json:"agent,omitempty"`
	Office           *ListingContact `json:"office,omitempty"`
}

// ListingsSearchResult is returned by listings_search.
type ListingsSearchResult struct {
	Intent   string         `json:"intent"`
	Listings []Listing      `json:"listings"`
	Count    int            `json:"count"`
	Total    int            `json:"total,omitempty"`
	Limit    int            `json:"limit"`
	Offset   int            `json:"offset"`
	Summary  string         `json:"summary,omitempty"`
	Query    map[string]any `json:"query,omitempty"`
	Note     string         `json:"note,omitempty"`
	Usage    *Usage         `json:"usage,omitempty"`
}

// RentEstimateRequest is the AVM input.
type RentEstimateRequest struct {
	Address       string
	PropertyType  string
	Bedrooms      string
	Bathrooms     string
	SquareFootage string
}

// RentEstimateResult is a lean AVM response.
type RentEstimateResult struct {
	Address       string  `json:"address"`
	RentEstimate  float64 `json:"rent_estimate,omitempty"`
	RentRangeLow  float64 `json:"rent_range_low,omitempty"`
	RentRangeHigh float64 `json:"rent_range_high,omitempty"`
	PropertyType  string  `json:"property_type,omitempty"`
	Bedrooms      float64 `json:"bedrooms,omitempty"`
	Bathrooms     float64 `json:"bathrooms,omitempty"`
	Note          string  `json:"note,omitempty"`
	Usage         *Usage  `json:"usage,omitempty"`
}

// MarketTypeStat is rent stats for one property type in a zip.
type MarketTypeStat struct {
	PropertyType  string  `json:"property_type"`
	AverageRent   float64 `json:"average_rent,omitempty"`
	MedianRent    float64 `json:"median_rent,omitempty"`
	TotalListings int     `json:"total_listings,omitempty"`
}

// MarketStatsResult is zip-level market context (rental slice only).
type MarketStatsResult struct {
	ZipCode             string           `json:"zip_code"`
	AverageRent         float64          `json:"average_rent,omitempty"`
	MedianRent          float64          `json:"median_rent,omitempty"`
	MinRent             float64          `json:"min_rent,omitempty"`
	MaxRent             float64          `json:"max_rent,omitempty"`
	TotalListings       int              `json:"total_listings,omitempty"`
	NewListings         int              `json:"new_listings,omitempty"`
	AverageDaysOnMarket float64          `json:"average_days_on_market,omitempty"`
	MedianDaysOnMarket  float64          `json:"median_days_on_market,omitempty"`
	ByPropertyType      []MarketTypeStat `json:"by_property_type,omitempty"`
	Note                string           `json:"note,omitempty"`
	Usage               *Usage           `json:"usage,omitempty"`
}

// ListingGetResult is listings_get with an optional local usage snapshot.
type ListingGetResult struct {
	Listing
	Usage *Usage `json:"usage,omitempty"`
}
