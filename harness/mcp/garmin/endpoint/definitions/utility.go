package definitions

import (
	"context"
	"time"

	"github.com/shotah/go-garmin/endpoint"
)

// UtilityEndpoints defines utility endpoints that don't call the Garmin API.
var UtilityEndpoints = []endpoint.Endpoint{
	{
		Name:       "GetCurrentDate",
		Service:    "Utility",
		Cassette:   "none",
		Path:       "local://current-date",
		HTTPMethod: "GET",
		MCPTool:    "utility_get_current_date",
		Short:      "Today's local calendar date",
		Long: "Returns today's local date (YYYY-MM-DD), weekday, and ISO timestamp. " +
			"Use when you need an explicit date before calling dated Garmin tools; " +
			"most tools already default date=today so you can often skip this.",
		Handler: func(_ context.Context, _ any, _ *endpoint.HandlerArgs) (any, error) {
			now := time.Now()
			return map[string]any{
				"date":       now.Format("2006-01-02"),
				"year":       now.Year(),
				"month":      int(now.Month()),
				"month_name": now.Month().String(),
				"day":        now.Day(),
				"weekday":    now.Weekday().String(),
				"iso8601":    now.Format(time.RFC3339),
			}, nil
		},
	},
}
