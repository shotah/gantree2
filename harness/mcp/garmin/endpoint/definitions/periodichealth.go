package definitions

import (
	"context"
	"fmt"
	"time"

	"github.com/shotah/go-garmin/endpoint"
	"github.com/shotah/go-garmin/garmin"
)

// PeriodicHealthEndpoints defines menstrual cycle and pregnancy endpoints.
var PeriodicHealthEndpoints = []endpoint.Endpoint{
	{
		Name:       "GetMenstrualDayView",
		Service:    "PeriodicHealth",
		Cassette:   "periodichealth",
		Path:       "/periodichealth-service/menstrualcycle/dayview/{date}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for cycle day view (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "health",
		CLISubcommand: "day",
		MCPTool:       "periodic_health_get_menstrual_day",
		Short:         "Cycle / symptoms for one day",
		Long: "Menstrual or pregnancy day view: cycle phase summary and logged symptoms for one calendar day. " +
			"Use for 'period today', symptoms. Multi-day calendar: periodic_health_get_menstrual_calendar.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.PeriodicHealth.GetMenstrualDayView(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetMenstrualCalendar",
		Service:    "PeriodicHealth",
		Cassette:   "periodichealth",
		Path:       "/periodichealth-service/menstrualcycle/calendar/{start}/{end}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for calendar view (defaults to last 7 days)"},
		},
		CLICommand:    "health",
		CLISubcommand: "calendar",
		MCPTool:       "periodic_health_get_menstrual_calendar",
		Short:         "Cycle calendar over range",
		Long: "Menstrual calendar over a date range (default last 7 days): cycle days, symptoms, ovulation, notes. " +
			"Use for 'cycle this month'. Single day: periodic_health_get_menstrual_day.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			end := time.Now()
			start := end.AddDate(0, 0, -7)
			if args.HasParam("start") {
				start = args.Date("start")
			}
			if args.HasParam("end") {
				end = args.Date("end")
			}
			return client.PeriodicHealth.GetMenstrualCalendar(ctx, start, end)
		},
	},
	{
		Name:          "GetPregnancySnapshot",
		Service:       "PeriodicHealth",
		Cassette:      "periodichealth",
		Path:          "/periodichealth-service/menstrualcycle/pregnancysnapshot",
		HTTPMethod:    "GET",
		CLICommand:    "health",
		CLISubcommand: "pregnancy",
		MCPTool:       "periodic_health_get_pregnancy",
		Short:         "Pregnancy tracking summary",
		Long: "Current pregnancy snapshot summary from Connect (due date context, tracking status). " +
			"Use for 'pregnancy tracking', pregnancy overview.",
		Handler: func(ctx context.Context, c any, _ *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.PeriodicHealth.GetPregnancySnapshot(ctx)
		},
	},
}
