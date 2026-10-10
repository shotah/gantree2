package definitions

import (
	"context"
	"fmt"

	"github.com/shotah/go-garmin/endpoint"
	"github.com/shotah/go-garmin/garmin"
)

// HRVEndpoints defines all HRV-related endpoints.
var HRVEndpoints = []endpoint.Endpoint{
	{
		Name:       "GetDailyHRV",
		Service:    "HRV",
		Cassette:   "hrv",
		Path:       "/hrv-service/hrv",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for HRV status (YYYY-MM-DD, defaults to today; overnight HRV is attributed to the wake-up day)"},
		},
		CLICommand:    "hrv",
		CLISubcommand: "daily",
		MCPTool:       "hrv_get",
		Short:         "HRV status / overnight average",
		Long: "Heart-rate variability for a day: overnight average, weekly average, and baseline range. " +
			"Use for 'HRV', 'recovery', 'nervous system readiness'. Pair with sleep_get / metrics_get_training_readiness for coaching. " +
			"Not a sleep score — use sleep_get for sleep quality.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.HRV.GetDaily(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetHRVRange",
		Service:    "HRV",
		Cassette:   "hrv",
		Path:       "/hrv-service/hrv/daily",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for HRV data"},
		},
		CLICommand:    "hrv",
		CLISubcommand: "range",
		Short:         "HRV trend over a date range",
		Long:          "HRV daily summaries over a date range. Use for multi-day HRV trends. For today's/overnight HRV prefer hrv_get.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			start := args.Date("start")
			end := args.Date("end")
			return client.HRV.GetRange(ctx, start, end)
		},
	},
}
