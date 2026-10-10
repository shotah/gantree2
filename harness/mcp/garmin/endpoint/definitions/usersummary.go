package definitions

import (
	"context"
	"fmt"
	"reflect"
	"time"

	"github.com/shotah/go-garmin/endpoint"
	"github.com/shotah/go-garmin/garmin"
)

var hydrationLogBodyConfig = &endpoint.BodyConfig{
	Type: reflect.TypeFor[garmin.HydrationLogRequest](),
	Description: `JSON object to log hydration intake. Required fields: calendarDate, timestampLocal, valueInML.

- calendarDate (string, YYYY-MM-DD): Day to attribute the intake to
- timestampLocal (string): Local timestamp, e.g. "2026-07-15T12:00:00.000"
- valueInML (number): Milliliters to add (positive) or subtract (negative)

The live Connect API expects PUT.`,
	Example: `{
  "calendarDate": "2026-07-15",
  "timestampLocal": "2026-07-15T12:00:00.000",
  "valueInML": 250
}`,
}

// UserSummaryEndpoints defines usersummary-service endpoints (daily totals, hydration, stats).
var UserSummaryEndpoints = []endpoint.Endpoint{
	{
		Name:       "GetDailyUserSummary",
		Service:    "UserSummary",
		Cassette:   "usersummary",
		Path:       "/usersummary-service/usersummary/daily/{displayName}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for the home-screen summary (YYYY-MM-DD, defaults to today)"},
			{Name: "display_name", Type: endpoint.ParamTypeString, Required: false, Description: "User display name (defaults to current user)"},
		},
		CLICommand:    "summary",
		CLISubcommand: "daily",
		MCPTool:       "summary_get_daily",
		Short:         "Home-screen daily totals",
		Long: "Connect home-screen daily totals: steps, calories, distance, floors, intensity, stress, Body Battery snapshot. " +
			"Use for 'how active was I today', steps/calories overview. Prefer sleep_get for overnight sleep and weight_get for scale readings.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			displayName, err := client.ResolveDisplayName(ctx, args.String("display_name"))
			if err != nil {
				return nil, err
			}
			return client.UserSummary.GetDaily(ctx, displayName, args.Date("date"))
		},
	},
	{
		Name:       "GetDailyHydration",
		Service:    "UserSummary",
		Cassette:   "usersummary",
		Path:       "/usersummary-service/usersummary/hydration/daily/{date}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for hydration (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "summary",
		CLISubcommand: "hydration",
		MCPTool:       "summary_get_hydration",
		Short:         "Today's hydration vs goal",
		Long: "Hydration intake and daily goal for one calendar day. " +
			"Use for 'how much water did I drink', hydration goal. Multi-day trends: summary_get_hydration_stats.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.UserSummary.GetHydration(ctx, args.Date("date"))
		},
	},
	{
		Name:          "LogHydration",
		Service:       "UserSummary",
		Cassette:      "none",
		Path:          "/usersummary-service/usersummary/hydration/log",
		HTTPMethod:    "PUT",
		Body:          hydrationLogBodyConfig,
		CLICommand:    "summary",
		CLISubcommand: "log-hydration",
		MCPTool:       "summary_log_hydration",
		Short:         "Log water intake",
		Long: "Add or adjust hydration (ml) on Connect for a calendar day via JSON body. " +
			"Use for 'log water', 'add 250ml'. Use --file, --json, or stdin; live API uses PUT.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			req, ok := args.Body.(*garmin.HydrationLogRequest)
			if !ok {
				return nil, fmt.Errorf("invalid hydration log body type: %T", args.Body)
			}
			return client.UserSummary.LogHydration(ctx, req)
		},
	},
	{
		Name:       "GetStepsDailyStats",
		Service:    "UserSummary",
		Cassette:   "usersummary",
		Path:       "/usersummary-service/stats/steps/daily/{start}/{end}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for daily steps (defaults to last 7 days; ranges >28 days are chunked)"},
		},
		CLICommand:    "summary",
		CLISubcommand: "steps-daily",
		MCPTool:       "summary_get_steps_daily",
		Short:         "Multi-day steps + distance",
		Long: "Daily steps and distance for a date range (default last 7 days; >28 days chunked). " +
			"Use for 'steps this week', walking trends. Today's snapshot: summary_get_daily.",
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
			return client.UserSummary.GetStepsDaily(ctx, start, end)
		},
	},
	{
		Name:       "GetStepsWeeklyStats",
		Service:    "UserSummary",
		Cassette:   "usersummary",
		Path:       "/usersummary-service/stats/steps/weekly/{end}/{weeks}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "end", Type: endpoint.ParamTypeDate, Required: false, Description: "Last day of weekly window (YYYY-MM-DD, defaults to today)"},
			{Name: "weeks", Type: endpoint.ParamTypeInt, Required: false, Description: "Number of weeks (default 4)"},
		},
		CLICommand:    "summary",
		CLISubcommand: "steps-weekly",
		MCPTool:       "summary_get_steps_weekly",
		Short:         "Weekly steps aggregates",
		Long: "Weekly rolled-up steps and distance ending on the given date (default 4 weeks). " +
			"Use for 'steps per week'. Per-day detail: summary_get_steps_daily.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.UserSummary.GetStepsWeekly(ctx, args.Date("end"), args.IntOrDefault("weeks", 4))
		},
	},
	{
		Name:       "GetStressDailyStats",
		Service:    "UserSummary",
		Cassette:   "usersummary",
		Path:       "/usersummary-service/stats/stress/daily/{start}/{end}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for daily stress stats (defaults to last 7 days)"},
		},
		CLICommand:    "summary",
		CLISubcommand: "stress-daily",
		MCPTool:       "summary_get_stress_daily",
		Short:         "Multi-day stress summaries",
		Long: "Daily stress summary values over a date range (default last 7 days). " +
			"Use for 'stress this week'. Intraday chart for one day: wellness_get_stress.",
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
			return client.UserSummary.GetStressDaily(ctx, start, end)
		},
	},
	{
		Name:       "GetStressWeeklyStats",
		Service:    "UserSummary",
		Cassette:   "usersummary",
		Path:       "/usersummary-service/stats/stress/weekly/{end}/{weeks}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "end", Type: endpoint.ParamTypeDate, Required: false, Description: "Last day of weekly window (YYYY-MM-DD, defaults to today)"},
			{Name: "weeks", Type: endpoint.ParamTypeInt, Required: false, Description: "Number of weeks (default 4)"},
		},
		CLICommand:    "summary",
		CLISubcommand: "stress-weekly",
		MCPTool:       "summary_get_stress_weekly",
		Short:         "Weekly stress aggregates",
		Long: "Weekly aggregated stress ending on the given date (default 4 weeks). " +
			"Use for stress trends by week. Single-day detail: wellness_get_stress.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.UserSummary.GetStressWeekly(ctx, args.Date("end"), args.IntOrDefault("weeks", 4))
		},
	},
	{
		Name:       "GetHydrationStats",
		Service:    "UserSummary",
		Cassette:   "usersummary",
		Path:       "/usersummary-service/stats/hydration/daily/{start}/{end}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for hydration stats (defaults to last 7 days)"},
		},
		CLICommand:    "summary",
		CLISubcommand: "hydration-stats",
		MCPTool:       "summary_get_hydration_stats",
		Short:         "Multi-day hydration intake",
		Long: "Daily hydration intake stats over a date range (default last 7 days). " +
			"Use for 'water intake this week'. Single day + goal: summary_get_hydration.",
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
			return client.UserSummary.GetHydrationStats(ctx, start, end)
		},
	},
	{
		Name:       "GetIntensityMinutesDailyStats",
		Service:    "UserSummary",
		Cassette:   "usersummary",
		Path:       "/usersummary-service/stats/im/daily/{start}/{end}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for daily intensity minutes (defaults to last 7 days)"},
		},
		CLICommand:    "summary",
		CLISubcommand: "im-daily",
		MCPTool:       "summary_get_intensity_minutes_daily",
		Short:         "Multi-day intensity minutes",
		Long: "Daily moderate and vigorous intensity minutes over a date range (default last 7 days). " +
			"Use for weekly goal progress history. Current week status: wellness_get_intensity_minutes.",
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
			return client.UserSummary.GetIntensityMinutesDaily(ctx, start, end)
		},
	},
	{
		Name:       "GetIntensityMinutesWeeklyStats",
		Service:    "UserSummary",
		Cassette:   "usersummary",
		Path:       "/usersummary-service/stats/im/weekly/{start}/{end}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for weekly intensity minutes (defaults to last 28 days)"},
		},
		CLICommand:    "summary",
		CLISubcommand: "im-weekly",
		MCPTool:       "summary_get_intensity_minutes_weekly",
		Short:         "Weekly intensity minutes rollups",
		Long: "Weekly moderate/vigorous intensity minute aggregates over a date range (default last 28 days). " +
			"Use for 'intensity minutes by week'. Today's week progress: wellness_get_intensity_minutes.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			end := time.Now()
			start := end.AddDate(0, 0, -28)
			if args.HasParam("start") {
				start = args.Date("start")
			}
			if args.HasParam("end") {
				end = args.Date("end")
			}
			return client.UserSummary.GetIntensityMinutesWeekly(ctx, start, end)
		},
	},
}
