package definitions

import (
	"context"
	"fmt"
	"time"

	"github.com/shotah/go-garmin/endpoint"
	"github.com/shotah/go-garmin/garmin"
)

// WellnessEndpoints defines all wellness-related endpoints.
var WellnessEndpoints = []endpoint.Endpoint{
	{
		Name:       "GetDailyStress",
		Service:    "Wellness",
		Cassette:   "wellness_stress",
		Path:       "/wellness-service/wellness/dailyStress",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for stress (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "wellness",
		CLISubcommand: "stress",
		MCPTool:       "wellness_get_stress",
		Short:         "All-day stress levels",
		Long: "Intraday stress levels for one day (max, average, chart). Use for 'stress today', 'how stressed was I'. " +
			"Not Body Battery (wellness_get_body_battery) and not overnight HRV (hrv_get).",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Wellness.GetDailyStress(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetBodyBatteryEvents",
		Service:    "Wellness",
		Cassette:   "wellness_body_battery",
		Path:       "/wellness-service/wellness/bodyBattery/events",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for Body Battery events (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "wellness",
		CLISubcommand: "body-battery",
		MCPTool:       "wellness_get_body_battery",
		Short:         "Body Battery energy events (NOT sleep score)",
		Long: "NOT for sleep score / 'how did I sleep' / last night — use sleep_get for that. " +
			"Body Battery charge/drain events for one day (energy timeline). " +
			"Use only for 'body battery', 'energy level', 'am I drained'. " +
			"Multi-day totals: wellness_get_body_battery_reports.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Wellness.GetBodyBatteryEvents(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetDailyHeartRate",
		Service:    "Wellness",
		Cassette:   "wellness_heart_rate",
		Path:       "/wellness-service/wellness/dailyHeartRate",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for heart rate (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "wellness",
		CLISubcommand: "heart-rate",
		MCPTool:       "wellness_get_heart_rate",
		Short:         "Daily resting/max HR + zones",
		Long: "All-day heart rate for a date: resting HR, max HR, time in zones. Use for 'resting heart rate', 'HR today'. " +
			"Not HRV (hrv_get) and not per-activity HR zones (activities_get_hr_zones).",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Wellness.GetDailyHeartRate(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetDailySpO2",
		Service:    "Wellness",
		Cassette:   "wellness_extended",
		Path:       "/wellness-service/wellness/daily/spo2",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for SpO2 (YYYY-MM-DD, defaults to today; sleep SpO2 uses wake-up day)"},
		},
		CLICommand:    "wellness",
		CLISubcommand: "spo2",
		MCPTool:       "wellness_get_spo2",
		Short:         "Daily SpO2 / blood oxygen",
		Long: "Blood oxygen (SpO2) for one calendar day: average, lowest, and sleep SpO2 when available. " +
			"Use for 'blood oxygen', 'SpO2'. Not respiration rate — use wellness_get_respiration.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Wellness.GetDailySpO2(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetDailyRespiration",
		Service:    "Wellness",
		Cassette:   "wellness_extended",
		Path:       "/wellness-service/wellness/daily/respiration",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for respiration (YYYY-MM-DD, defaults to today; sleep values use wake-up day)"},
		},
		CLICommand:    "wellness",
		CLISubcommand: "respiration",
		MCPTool:       "wellness_get_respiration",
		Short:         "Daily breathing rate",
		Long: "Respiration rate for one calendar day: waking and sleep averages. " +
			"Use for 'breathing rate', 'respiration while sleeping'. Not SpO2 — use wellness_get_spo2.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Wellness.GetDailyRespiration(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetDailyIntensityMinutes",
		Service:    "Wellness",
		Cassette:   "wellness_extended",
		Path:       "/wellness-service/wellness/daily/im",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Anchor day for weekly intensity minutes (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "wellness",
		CLISubcommand: "intensity-minutes",
		MCPTool:       "wellness_get_intensity_minutes",
		Short:         "Weekly intensity minutes progress",
		Long: "Moderate + vigorous intensity minutes and progress toward the weekly goal (as of the given day). " +
			"Use for 'intensity minutes', 'am I hitting my activity goal'. Not a workout list — use activities_list for that.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Wellness.GetDailyIntensityMinutes(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetDailyEvents",
		Service:    "Wellness",
		Cassette:   "wellness_daily_extra",
		Path:       "/wellness-service/wellness/dailyEvents",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for detected events (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "wellness",
		CLISubcommand: "events",
		MCPTool:       "wellness_get_daily_events",
		Short:         "Auto-detected wellness events",
		Long: "Garmin-detected wellness events for one day (auto activities, naps, etc.). " +
			"Use for 'what did my watch detect today'. Not full workouts — use activities_list for sessions.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Wellness.GetDailyEvents(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetWellnessDailySleep",
		Service:    "Wellness",
		Cassette:   "wellness_daily_extra",
		Path:       "/wellness-service/wellness/dailySleepData/{displayName}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Date to get sleep data for (YYYY-MM-DD, defaults to today)"},
			{Name: "display_name", Type: endpoint.ParamTypeString, Required: false, Description: "User display name (defaults to current user)"},
		},
		CLICommand:    "wellness",
		CLISubcommand: "sleep",
		MCPTool:       "wellness_get_sleep",
		Short:         "Alternate sleep API (prefer sleep_get)",
		Long: "Alternate wellness-service sleep payload. Prefer sleep_get for 'how did I sleep' / sleep score / last night — " +
			"that is the primary sleep tool. Only use this if sleep_get is unavailable or you need this specific path.",
		DependsOn: "GetSocialProfile",
		ArgProvider: func(result any) map[string]any {
			profile, ok := result.(*garmin.SocialProfile)
			if !ok || profile == nil {
				return nil
			}
			return map[string]any{"display_name": profile.DisplayName}
		},
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			displayName, err := client.ResolveDisplayName(ctx, args.String("display_name"))
			if err != nil {
				return nil, err
			}
			return client.Wellness.GetDailySleep(ctx, displayName, args.Date("date"))
		},
	},
	{
		Name:       "GetDailySummaryChart",
		Service:    "Wellness",
		Cassette:   "wellness_daily_extra",
		Path:       "/wellness-service/wellness/dailySummaryChart/{displayName}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for intraday steps chart (YYYY-MM-DD, defaults to today)"},
			{Name: "display_name", Type: endpoint.ParamTypeString, Required: false, Description: "User display name (defaults to current user)"},
		},
		CLICommand:    "wellness",
		CLISubcommand: "steps",
		MCPTool:       "wellness_get_steps_chart",
		Short:         "Intraday steps timeline",
		Long: "Intraday steps/activity chart (~15-min buckets) for one calendar day. " +
			"Use for 'when did I walk today', step patterns. Prefer summary_get_daily for today's total; summary_get_steps_daily for multi-day trends.",
		DependsOn: "GetSocialProfile",
		ArgProvider: func(result any) map[string]any {
			profile, ok := result.(*garmin.SocialProfile)
			if !ok || profile == nil {
				return nil
			}
			return map[string]any{"display_name": profile.DisplayName}
		},
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			displayName, err := client.ResolveDisplayName(ctx, args.String("display_name"))
			if err != nil {
				return nil, err
			}
			return client.Wellness.GetDailySummaryChart(ctx, displayName, args.Date("date"))
		},
	},
	{
		Name:       "GetDailyFloors",
		Service:    "Wellness",
		Cassette:   "wellness_daily_extra",
		Path:       "/wellness-service/wellness/floorsChartData/daily",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for floors chart (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "wellness",
		CLISubcommand: "floors",
		MCPTool:       "wellness_get_floors",
		Short:         "Floors up/down intraday chart",
		Long: "Floors ascended and descended over one calendar day. " +
			"Use for 'floors climbed today'. Daily total also on summary_get_daily.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Wellness.GetDailyFloors(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetBodyBatteryReports",
		Service:    "Wellness",
		Cassette:   "wellness_daily_extra",
		Path:       "/wellness-service/wellness/bodyBattery/reports/daily",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for Body Battery daily totals (defaults to last 7 days)"},
		},
		CLICommand:    "wellness",
		CLISubcommand: "body-battery-reports",
		MCPTool:       "wellness_get_body_battery_reports",
		Short:         "Multi-day Body Battery charged/drained",
		Long: "Daily Body Battery charged/drained totals over a date range (default last 7 days). " +
			"Use for weekly energy trends. For today's event timeline use wellness_get_body_battery.",
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
			return client.Wellness.GetBodyBatteryReports(ctx, start, end)
		},
	},
	{
		Name:       "GetSleepScoreStats",
		Service:    "Wellness",
		Cassette:   "wellness_daily_extra",
		Path:       "/wellness-service/stats/daily/sleep/score",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for daily sleep scores (defaults to last 7 days)"},
		},
		CLICommand:    "wellness",
		CLISubcommand: "sleep-score",
		MCPTool:       "wellness_get_sleep_score_stats",
		Short:         "Multi-day sleep score trend",
		Long: "Daily sleep scores only over a date range (default last 7 days) — no stages/duration detail. " +
			"Use for 'sleep score this week'. For last night's full sleep (stages, duration, score) use sleep_get.",
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
			return client.Wellness.GetSleepScoreStats(ctx, start, end)
		},
	},
}
