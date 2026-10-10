package rentcast

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	defaultBaseURL   = "https://api.rentcast.io/v1"
	defaultLimit     = 10
	maxAgentLimit    = 50
	maxRadiusMiles   = 100
	userAgent        = "rentals-search-mcp/1.0"
	maxResponseBytes = 8 << 20
)

// Client talks to RentCast with X-Api-Key auth.
type Client struct {
	APIKey     string
	BaseURL    string
	HTTPClient *http.Client
	Usage      *UsageTracker // optional local quota counter
}

// NewFromEnv builds a client from RENTCAST_API_KEY (+ optional RENTCAST_BASE_URL).
func NewFromEnv() (*Client, error) {
	key := strings.TrimSpace(os.Getenv("RENTCAST_API_KEY"))
	if key == "" {
		return nil, errors.New("RENTCAST_API_KEY is required")
	}
	base := strings.TrimSpace(os.Getenv("RENTCAST_BASE_URL"))
	if base == "" {
		base = defaultBaseURL
	}
	return &Client{
		APIKey:  key,
		BaseURL: strings.TrimRight(base, "/"),
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		Usage: NewUsageTrackerFromEnv(),
	}, nil
}

// AccountUsage returns the local usage snapshot (nil if tracking disabled).
func (c *Client) AccountUsage() *Usage {
	if c == nil {
		return nil
	}
	return c.Usage.Snapshot()
}

func (c *Client) attachUsage() *Usage {
	if c == nil {
		return nil
	}
	return c.Usage.Snapshot()
}

// SearchListings calls GET /listings/rental/long-term or GET /listings/sale.
func (c *Client) SearchListings(ctx context.Context, req ListingsSearchRequest) (*ListingsSearchResult, error) {
	intent, err := NormalizeIntent(req.Intent)
	if err != nil {
		return nil, err
	}
	req.Intent = intent
	expanded, expandNotes, err := ExpandSearchRequest(req)
	if err != nil {
		return nil, err
	}
	req = expanded
	if err := validateSearchRequest(req); err != nil {
		return nil, err
	}
	limit, offset := normalizePage(req.Limit, req.Offset)
	params, queryEcho := searchParams(req, limit, offset)
	params.Set("includeTotalCount", "true")

	var raw []rawListing
	hdr, err := c.getJSON(ctx, listingsSearchPath(intent), params, &raw)
	if err != nil {
		return nil, err
	}

	listings := make([]Listing, 0, len(raw))
	for i := range raw {
		listings = append(listings, raw[i].toListing(intent))
	}

	// Client-side zip narrowing for multi-zip / neighborhood presets (one API call).
	filtered := false
	if len(req.ZipFilter) > 1 || (len(req.ZipFilter) > 0 && strings.TrimSpace(req.ZipCode) == "") {
		before := len(listings)
		listings = filterListingsByZips(listings, req.ZipFilter)
		if len(listings) < before {
			filtered = true
			expandNotes = append(expandNotes, fmt.Sprintf("client zip filter kept %d/%d results", len(listings), before))
		}
	}

	total := len(listings)
	if !filtered {
		if v := hdr.Get("X-Total-Count"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n >= 0 {
				total = n
			}
		}
	}

	note := searchHandoffNote(intent)
	note = joinNotes(note, expandNotes)

	return &ListingsSearchResult{
		Intent:   intent,
		Listings: listings,
		Count:    len(listings),
		Total:    total,
		Limit:    limit,
		Offset:   offset,
		Summary:  summarizeListings(listings, total, limit, offset, intent),
		Query:    queryEcho,
		Note:     note,
		Usage:    c.attachUsage(),
	}, nil
}

// GetListing calls GET /listings/rental/long-term/{id} or GET /listings/sale/{id}.
func (c *Client) GetListing(ctx context.Context, id, intent string) (*ListingGetResult, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, errors.New("listing id is required")
	}
	normalized, err := NormalizeIntent(intent)
	if err != nil {
		return nil, err
	}
	var raw rawListing
	if _, err := c.getJSON(ctx, listingGetPath(id, normalized), nil, &raw); err != nil {
		return nil, err
	}
	return &ListingGetResult{
		Listing: raw.toListing(normalized),
		Usage:   c.attachUsage(),
	}, nil
}

// RentEstimate calls GET /avm/rent/long-term.
func (c *Client) RentEstimate(ctx context.Context, req RentEstimateRequest) (*RentEstimateResult, error) {
	address := strings.TrimSpace(req.Address)
	if address == "" {
		return nil, errors.New("address is required")
	}
	params := url.Values{}
	params.Set("address", address)
	if pt := NormalizePropertyType(req.PropertyType); pt != "" {
		params.Set("propertyType", pt)
	}
	if v := strings.TrimSpace(req.Bedrooms); v != "" {
		params.Set("bedrooms", v)
	}
	if v := strings.TrimSpace(req.Bathrooms); v != "" {
		params.Set("bathrooms", v)
	}
	if v := strings.TrimSpace(req.SquareFootage); v != "" {
		params.Set("squareFootage", v)
	}

	var raw rawRentEstimate
	if _, err := c.getJSON(ctx, "/avm/rent/long-term", params, &raw); err != nil {
		return nil, err
	}

	out := &RentEstimateResult{
		Address:       address,
		RentEstimate:  raw.Rent,
		RentRangeLow:  raw.RentRangeLow,
		RentRangeHigh: raw.RentRangeHigh,
		Note:          "AVM estimate only — verify against live listings before deciding.",
		Usage:         c.attachUsage(),
	}
	if raw.SubjectProperty != nil {
		if a := strings.TrimSpace(raw.SubjectProperty.FormattedAddress); a != "" {
			out.Address = a
		}
		out.PropertyType = raw.SubjectProperty.PropertyType
		out.Bedrooms = raw.SubjectProperty.Bedrooms
		out.Bathrooms = raw.SubjectProperty.Bathrooms
	}
	return out, nil
}

// MarketStats calls GET /markets for rental aggregates in a zip.
func (c *Client) MarketStats(ctx context.Context, zipCode string) (*MarketStatsResult, error) {
	zipCode = strings.TrimSpace(zipCode)
	if zipCode == "" {
		return nil, errors.New("zip_code is required")
	}
	params := url.Values{}
	params.Set("zipCode", zipCode)
	params.Set("dataType", "Rental")
	params.Set("historyRange", "1")

	var raw rawMarket
	if _, err := c.getJSON(ctx, "/markets", params, &raw); err != nil {
		return nil, err
	}

	out := &MarketStatsResult{ZipCode: zipCode}
	if z := strings.TrimSpace(raw.ZipCode); z != "" {
		out.ZipCode = z
	}
	if raw.RentalData != nil {
		rd := raw.RentalData
		out.AverageRent = rd.AverageRent
		out.MedianRent = rd.MedianRent
		out.MinRent = rd.MinRent
		out.MaxRent = rd.MaxRent
		out.TotalListings = rd.TotalListings
		out.NewListings = rd.NewListings
		out.AverageDaysOnMarket = rd.AverageDaysOnMarket
		out.MedianDaysOnMarket = rd.MedianDaysOnMarket
		for _, pt := range rd.DataByPropertyType {
			out.ByPropertyType = append(out.ByPropertyType, MarketTypeStat(pt))
		}
	}
	out.Note = "Zip-level rental aggregates. Pair with listings_search for concrete handoff candidates."
	out.Usage = c.attachUsage()
	return out, nil
}

// NormalizePropertyType maps agent aliases to RentCast propertyType values.
// Comma / pipe / semicolon lists become one RentCast multi-value (house,condo → Single Family|Condo).
func NormalizePropertyType(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	if strings.ContainsAny(s, "|,;") {
		s = strings.ReplaceAll(s, ",", "|")
		s = strings.ReplaceAll(s, ";", "|")
		parts := strings.Split(s, "|")
		out := make([]string, 0, len(parts))
		for _, p := range parts {
			if n := normalizeOnePropertyType(p); n != "" {
				out = append(out, n)
			}
		}
		return strings.Join(out, "|")
	}
	return normalizeOnePropertyType(s)
}

func normalizeOnePropertyType(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	switch strings.ToLower(strings.ReplaceAll(s, "-", "_")) {
	case "apartment", "apartments":
		return "Apartment"
	case "house", "home", "homes", "single_family", "singlefamily", "sfh":
		return "Single Family"
	case "condo", "condos", "condominium":
		return "Condo"
	case "townhouse", "townhome", "townhouses", "townhomes":
		return "Townhouse"
	case "manufactured", "mobile", "mobile_home":
		return "Manufactured"
	case "multi_family", "multifamily", "duplex", "triplex", "fourplex":
		return "Multi-Family"
	case "land", "lot", "lots":
		return "Land"
	default:
		// Pass through already-correct RentCast casing if provided.
		return s
	}
}

// NormalizeIntent maps agent aliases to IntentRent or IntentBuy.
// Empty defaults to rent (this MCP's for-rent catalog). Unknown values error.
func NormalizeIntent(raw string) (string, error) {
	s := strings.ToLower(strings.TrimSpace(raw))
	s = strings.ReplaceAll(s, "-", "_")
	s = strings.ReplaceAll(s, " ", "_")
	switch s {
	case "", IntentRent, "rental", "rentals", "lease", "leasing", "for_rent", "forrent":
		return IntentRent, nil
	case IntentBuy, "sale", "sales", "purchase", "purchasing", "buying", "for_sale", "forsale":
		return IntentBuy, nil
	default:
		return "", fmt.Errorf("intent must be rent or buy (got %q). Default is rent (long-term for-rent). Pass buy only for homes for sale", raw)
	}
}

func listingsSearchPath(intent string) string {
	if intent == IntentBuy {
		return "/listings/sale"
	}
	return "/listings/rental/long-term"
}

func listingGetPath(id, intent string) string {
	if intent == IntentBuy {
		return "/listings/sale/" + url.PathEscape(id)
	}
	return "/listings/rental/long-term/" + url.PathEscape(id)
}

func searchHandoffNote(intent string) string {
	action := "Do not apply or message landlords/agents on the human's behalf."
	if intent == IntentBuy {
		action = "Do not make offers or contact listing agents on the human's behalf."
	}
	return "RentCast has no Zillow/Apartments.com/Realtor listing URL. " +
		"ALWAYS present agent/office phone, email, and name — that is who is marketing this property. " +
		"agent.website / office.website are broker pages when present, not a unit listing. " +
		"search_url is a Google address fallback. " + action
}

func validateSearchRequest(req ListingsSearchRequest) error {
	intent, err := NormalizeIntent(req.Intent)
	if err != nil {
		return err
	}
	if intent == IntentRent && propertyTypeIncludesLand(req.PropertyType) {
		return errors.New("property_type=land is sale-only; for-rent search uses /listings/rental/long-term and cannot include land")
	}
	hasZip := strings.TrimSpace(req.ZipCode) != "" || len(req.ZipFilter) > 0
	hasCityState := strings.TrimSpace(req.City) != "" && strings.TrimSpace(req.State) != ""
	hasAddress := strings.TrimSpace(req.Address) != ""
	hasLatLng := req.Latitude != 0 || req.Longitude != 0
	if !hasZip && !hasCityState && !hasAddress && !hasLatLng {
		return errors.New("provide city+state, zip_code, neighborhood, address, or latitude/longitude")
	}
	if req.Radius < 0 {
		return errors.New("radius must be >= 0")
	}
	if req.Radius > maxRadiusMiles {
		return fmt.Errorf("radius max is %d miles", maxRadiusMiles)
	}
	if req.Offset < 0 {
		return errors.New("offset must be >= 0")
	}
	if req.DaysOldMax < 0 {
		return errors.New("days_old_max must be >= 0")
	}
	return nil
}

func normalizePage(limit, offset int) (int, int) {
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxAgentLimit {
		limit = maxAgentLimit
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func searchParams(req ListingsSearchRequest, limit, offset int) (url.Values, map[string]any) {
	params := url.Values{}
	echo := map[string]any{}
	if intent, err := NormalizeIntent(req.Intent); err == nil {
		echo["intent"] = intent
	}

	if v := strings.TrimSpace(req.City); v != "" {
		params.Set("city", v)
		echo["city"] = v
	}
	if v := strings.TrimSpace(req.State); v != "" {
		v = strings.ToUpper(v)
		params.Set("state", v)
		echo["state"] = v
	}
	if v := strings.TrimSpace(req.ZipCode); v != "" {
		params.Set("zipCode", v)
		echo["zip_code"] = v
	}
	if v := strings.TrimSpace(req.Address); v != "" {
		params.Set("address", v)
		echo["address"] = v
	}
	if req.Latitude != 0 {
		params.Set("latitude", formatFloat(req.Latitude))
		echo["latitude"] = req.Latitude
	}
	if req.Longitude != 0 {
		params.Set("longitude", formatFloat(req.Longitude))
		echo["longitude"] = req.Longitude
	}
	if req.Radius > 0 {
		params.Set("radius", formatFloat(req.Radius))
		echo["radius"] = req.Radius
	}
	if pt := NormalizePropertyType(req.PropertyType); pt != "" {
		params.Set("propertyType", pt)
		echo["property_type"] = pt
	}
	if v := strings.TrimSpace(req.Bedrooms); v != "" {
		params.Set("bedrooms", v)
		echo["bedrooms"] = v
	}
	if v := strings.TrimSpace(req.Bathrooms); v != "" {
		params.Set("bathrooms", v)
		echo["bathrooms"] = v
	}
	if v := strings.TrimSpace(req.SquareFootage); v != "" {
		params.Set("squareFootage", v)
		echo["square_footage"] = v
	}
	if price := formatPriceRange(req.PriceMin, req.PriceMax); price != "" {
		params.Set("price", price)
		echo["price"] = price
	}
	if v := strings.TrimSpace(req.DaysOld); v != "" {
		params.Set("daysOld", v)
		echo["days_old"] = v
	}
	if v := strings.TrimSpace(req.Neighborhood); v != "" {
		echo["neighborhood"] = v
	}
	if len(req.ZipFilter) > 0 {
		echo["zip_filter"] = req.ZipFilter
	}
	if req.NewThisWeek {
		echo["new_this_week"] = true
	}
	if req.PetsWanted {
		echo["pets_wanted"] = true
	}
	if req.ParkingWanted {
		echo["parking_wanted"] = true
	}
	if req.LaundryWanted {
		echo["laundry_wanted"] = true
	}
	status := strings.TrimSpace(req.Status)
	if status == "" {
		status = "Active"
	}
	params.Set("status", status)
	echo["status"] = status

	params.Set("limit", strconv.Itoa(limit))
	params.Set("offset", strconv.Itoa(offset))
	echo["limit"] = limit
	echo["offset"] = offset
	return params, echo
}

func formatPriceRange(priceMin, priceMax int) string {
	switch {
	case priceMin > 0 && priceMax > 0:
		return strconv.Itoa(priceMin) + ":" + strconv.Itoa(priceMax)
	case priceMin > 0:
		return strconv.Itoa(priceMin) + ":*"
	case priceMax > 0:
		return "*:" + strconv.Itoa(priceMax)
	default:
		return ""
	}
}

func formatFloat(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

func (c *Client) getJSON(ctx context.Context, path string, params url.Values, dest any) (http.Header, error) {
	if c == nil {
		return nil, errors.New("nil rentcast client")
	}
	if strings.TrimSpace(c.APIKey) == "" {
		return nil, errors.New("RENTCAST_API_KEY is required")
	}
	if err := c.Usage.Gate(confirmSpendFromCtx(ctx)); err != nil {
		return nil, err
	}
	base := c.BaseURL
	if base == "" {
		base = defaultBaseURL
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	endpoint := base + path
	if len(params) > 0 {
		endpoint += "?" + params.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, http.NoBody)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Api-Key", c.APIKey)
	req.Header.Set("User-Agent", userAgent)

	hc := c.HTTPClient
	if hc == nil {
		hc = http.DefaultClient
	}
	res, err := hc.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close() //nolint:errcheck // best-effort close after read

	body, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes))
	if err != nil {
		return res.Header, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return res.Header, fmt.Errorf("rentcast HTTP %d: %s", res.StatusCode, truncate(string(body), 400))
	}
	if err := json.Unmarshal(body, dest); err != nil {
		return res.Header, fmt.Errorf("decode rentcast response: %w", err)
	}
	// RentCast bills successful requests; count those locally.
	c.Usage.RecordSuccess()
	return res.Header, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// --- raw RentCast shapes ---

type rawContact struct {
	Name    string `json:"name"`
	Phone   string `json:"phone"`
	Email   string `json:"email"`
	Website string `json:"website"`
}

type rawListing struct {
	ID               string      `json:"id"`
	FormattedAddress string      `json:"formattedAddress"`
	City             string      `json:"city"`
	State            string      `json:"state"`
	ZipCode          string      `json:"zipCode"`
	PropertyType     string      `json:"propertyType"`
	Bedrooms         float64     `json:"bedrooms"`
	Bathrooms        float64     `json:"bathrooms"`
	SquareFootage    float64     `json:"squareFootage"`
	Price            float64     `json:"price"`
	Status           string      `json:"status"`
	DaysOnMarket     int         `json:"daysOnMarket"`
	ListedDate       string      `json:"listedDate"`
	Latitude         float64     `json:"latitude"`
	Longitude        float64     `json:"longitude"`
	ListingType      string      `json:"listingType"`
	MLSName          string      `json:"mlsName"`
	MLSNumber        string      `json:"mlsNumber"`
	ListingAgent     *rawContact `json:"listingAgent"`
	ListingOffice    *rawContact `json:"listingOffice"`
}

func (r rawListing) toListing(intent string) Listing {
	agent := contactFromRaw(r.ListingAgent)
	office := contactFromRaw(r.ListingOffice)
	out := Listing{
		ID:               r.ID,
		Intent:           intent,
		FormattedAddress: r.FormattedAddress,
		City:             r.City,
		State:            r.State,
		ZipCode:          r.ZipCode,
		PropertyType:     r.PropertyType,
		ListingType:      strings.TrimSpace(r.ListingType),
		Bedrooms:         r.Bedrooms,
		Bathrooms:        r.Bathrooms,
		SquareFootage:    r.SquareFootage,
		Price:            r.Price,
		Status:           r.Status,
		DaysOnMarket:     r.DaysOnMarket,
		ListedDate:       r.ListedDate,
		MLSName:          strings.TrimSpace(r.MLSName),
		MLSNumber:        strings.TrimSpace(r.MLSNumber),
		Latitude:         r.Latitude,
		Longitude:        r.Longitude,
		Agent:            agent,
		Office:           office,
	}
	out.SearchURL = googleListingSearchURL(listingAddress(out), intent)
	return out
}

func contactFromRaw(c *rawContact) *ListingContact {
	if c == nil {
		return nil
	}
	out := &ListingContact{
		Name:    strings.TrimSpace(c.Name),
		Phone:   strings.TrimSpace(c.Phone),
		Email:   strings.TrimSpace(c.Email),
		Website: strings.TrimSpace(c.Website),
	}
	if out.Name == "" && out.Phone == "" && out.Email == "" && out.Website == "" {
		return nil
	}
	return out
}

func propertyTypeIncludesLand(raw string) bool {
	n := NormalizePropertyType(raw)
	if n == "" {
		return false
	}
	for p := range strings.SplitSeq(n, "|") {
		if strings.EqualFold(strings.TrimSpace(p), "Land") {
			return true
		}
	}
	return false
}

func listingAddress(l Listing) string {
	if addr := strings.TrimSpace(l.FormattedAddress); addr != "" {
		return addr
	}
	parts := make([]string, 0, 4)
	if l.City != "" {
		parts = append(parts, l.City)
	}
	if l.State != "" {
		parts = append(parts, l.State)
	}
	if l.ZipCode != "" {
		parts = append(parts, l.ZipCode)
	}
	return strings.Join(parts, " ")
}

// googleListingSearchURL is the address handoff when we lack a portal property id.
func googleListingSearchURL(addr, intent string) string {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return ""
	}
	suffix := " rental"
	if intent == IntentBuy {
		suffix = " for sale"
	}
	return "https://www.google.com/search?q=" + url.QueryEscape(addr+suffix)
}

type rawRentEstimate struct {
	Rent            float64     `json:"rent"`
	RentRangeLow    float64     `json:"rentRangeLow"`
	RentRangeHigh   float64     `json:"rentRangeHigh"`
	SubjectProperty *rawListing `json:"subjectProperty"`
}

type rawMarketType struct {
	PropertyType  string  `json:"propertyType"`
	AverageRent   float64 `json:"averageRent"`
	MedianRent    float64 `json:"medianRent"`
	TotalListings int     `json:"totalListings"`
}

type rawRentalData struct {
	AverageRent         float64         `json:"averageRent"`
	MedianRent          float64         `json:"medianRent"`
	MinRent             float64         `json:"minRent"`
	MaxRent             float64         `json:"maxRent"`
	TotalListings       int             `json:"totalListings"`
	NewListings         int             `json:"newListings"`
	AverageDaysOnMarket float64         `json:"averageDaysOnMarket"`
	MedianDaysOnMarket  float64         `json:"medianDaysOnMarket"`
	DataByPropertyType  []rawMarketType `json:"dataByPropertyType"`
}

type rawMarket struct {
	ZipCode    string         `json:"zipCode"`
	RentalData *rawRentalData `json:"rentalData"`
}

func summarizeListings(listings []Listing, total, limit, offset int, intent string) string {
	if len(listings) == 0 {
		return "No listings matched. Widen beds/price, try a nearby zip, or drop property_type."
	}

	ranked := append([]Listing(nil), listings...)
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].DaysOnMarket != ranked[j].DaysOnMarket {
			return ranked[i].DaysOnMarket < ranked[j].DaysOnMarket
		}
		if ranked[i].Price != ranked[j].Price {
			return ranked[i].Price < ranked[j].Price
		}
		return ranked[i].ID < ranked[j].ID
	})

	n := min(3, len(ranked))
	parts := make([]string, 0, n)
	for i := range n {
		l := ranked[i]
		beds := formatBeds(l.Bedrooms)
		parts = append(parts, fmt.Sprintf("%s — %s, %s, %s (%d days on market)",
			shortAddress(l), formatListingPrice(l.Price, intent), beds, orDefault(l.PropertyType, "home"), l.DaysOnMarket))
	}

	pageNote := fmt.Sprintf("Showing %d", len(listings))
	if total > len(listings) {
		pageNote = fmt.Sprintf("Showing %d of ~%d", len(listings), total)
	}
	if offset > 0 {
		pageNote += fmt.Sprintf(" (offset %d)", offset)
	}
	newThisWeek := 0
	for i := range listings {
		if listings[i].DaysOnMarket > 0 && listings[i].DaysOnMarket <= 7 {
			newThisWeek++
		}
	}
	freshNote := ""
	if newThisWeek > 0 {
		freshNote = fmt.Sprintf(" %d listing(s) look new this week (≤7 days on market).", newThisWeek)
	}
	handoff := " ALWAYS present agent/office phone and email. search_url is a Google fallback — RentCast has no portal listing URL. Do not apply for them."
	if intent == IntentBuy {
		handoff = " ALWAYS present agent/office phone and email. search_url is a Google fallback. Do not make offers for them."
	}
	_ = limit
	return pageNote + ". Top picks (freshest / value): " + strings.Join(parts, "; ") + "." +
		freshNote +
		handoff
}

func formatListingPrice(price float64, intent string) string {
	if intent == IntentBuy {
		return fmt.Sprintf("$%.0f", price)
	}
	return fmt.Sprintf("$%.0f/mo", price)
}

func shortAddress(l Listing) string {
	if l.FormattedAddress != "" {
		return l.FormattedAddress
	}
	parts := make([]string, 0, 3)
	if l.City != "" {
		parts = append(parts, l.City)
	}
	if l.State != "" {
		parts = append(parts, l.State)
	}
	if l.ZipCode != "" {
		parts = append(parts, l.ZipCode)
	}
	if len(parts) == 0 {
		return l.ID
	}
	return strings.Join(parts, ", ")
}

func formatBeds(beds float64) string {
	if beds == 0 {
		return "studio"
	}
	if beds == float64(int(beds)) {
		return fmt.Sprintf("%.0fbd", beds)
	}
	return fmt.Sprintf("%gbd", beds)
}

func orDefault(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}
