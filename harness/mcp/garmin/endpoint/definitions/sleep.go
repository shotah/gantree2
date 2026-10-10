// endpoint/definitions/sleep.go
package definitions

import (
	"context"
	"fmt"

	"github.com/shotah/go-garmin/endpoint"
	garmin "github.com/shotah/go-garmin/garmin"
)

// SleepEndpoints defines all sleep-related API endpoints.
var SleepEndpoints = []endpoint.Endpoint{
	{
		Name:       "GetDailySleep",
		Service:    "Sleep",
		Cassette:   "sleep_daily",
		Path:       "/sleep-service/sleep/dailySleepData",
		HTTPMethod: "GET",

		Params: []endpoint.Param{
			{
				Name:     "date",
				Type:     endpoint.ParamTypeDate,
				Required: false,
				Description: "Wake-up calendar day (YYYY-MM-DD). CRITICAL: 'last night' / 'this morning' = TODAY " +
					"(or omit). Example: if today is 2026-07-28, pass 2026-07-28 — NOT 2026-07-27. Defaults to today.",
			},
		},

		CLICommand: "sleep",
		MCPTool:    "sleep_get",
		Short:      "Sleep score + stages (use for last night)",
		Long: "ONLY tool for overnight sleep / sleep score / 'how did I sleep' / 'last night' / sleep history. " +
			"Returns score, duration, deep/light/REM, awake time. Call immediately — do not narrate, do not use wellness_get_body_battery. " +
			"For 'last night', omit date or pass today (wake-up day). Prefer over wellness_get_sleep.",

		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Sleep.GetDaily(ctx, args.Date("date"))
		},
	},
}
