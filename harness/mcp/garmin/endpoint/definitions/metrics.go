package definitions

import (
	"context"
	"fmt"
	"time"

	"github.com/shotah/go-garmin/endpoint"
	"github.com/shotah/go-garmin/garmin"
)

// MetricsEndpoints defines all metrics-related endpoints.
var MetricsEndpoints = []endpoint.Endpoint{
	{
		Name:       "GetTrainingReadiness",
		Service:    "Metrics",
		Cassette:   "metrics",
		Path:       "/metrics-service/metrics/trainingreadiness/{date}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for readiness (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "metrics",
		CLISubcommand: "readiness",
		MCPTool:       "metrics_get_training_readiness",
		Short:         "Training readiness / recover-or-push",
		Long: "Garmin Training Readiness score plus contributing factors (sleep, recovery time, HRV, acute load, etc.). " +
			"Use for 'am I recovered enough to train', 'readiness', 'should I rest or push'. " +
			"For overnight sleep detail use sleep_get; for Body Battery events use wellness_get_body_battery.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Metrics.GetTrainingReadiness(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetEnduranceScore",
		Service:    "Metrics",
		Cassette:   "metrics",
		Path:       "/metrics-service/metrics/endurancescore",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for endurance score (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "metrics",
		CLISubcommand: "endurance",
		MCPTool:       "metrics_get_endurance_score",
		Short:         "Endurance score + classification",
		Long: "Endurance Score for one day: overall score, classification, and contributors. " +
			"Use for 'endurance score', long-activity fitness. Not VO2 max snapshot — use metrics_get_vo2max.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Metrics.GetEnduranceScore(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetHillScore",
		Service:    "Metrics",
		Cassette:   "metrics",
		Path:       "/metrics-service/metrics/hillscore",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for hill score (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "metrics",
		CLISubcommand: "hill",
		MCPTool:       "metrics_get_hill_score",
		Short:         "Hill score (strength/endurance)",
		Long: "Hill Score for one day: strength, endurance, and related metrics. " +
			"Use for 'hill score', climbing fitness. For trends over time use metrics_get_hill_score_stats.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Metrics.GetHillScore(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetHillScoreStats",
		Service:    "Metrics",
		Cassette:   "metrics",
		Path:       "/metrics-service/metrics/hillscore/stats",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for hill score stats (defaults to last 7 days)"},
			{Name: "aggregation", Type: endpoint.ParamTypeString, Required: false, Description: "Aggregation period: daily, weekly, monthly, yearly (default: daily)"},
		},
		CLICommand:    "metrics",
		CLISubcommand: "hill-stats",
		MCPTool:       "metrics_get_hill_score_stats",
		Short:         "Hill score trends over range",
		Long: "Hill Score statistics over a date range (default last 7 days) with daily/weekly/monthly/yearly aggregation. " +
			"Use for 'hill score history'. For today's score use metrics_get_hill_score.",
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
			aggregation := garmin.AggregationDaily
			if agg := args.String("aggregation"); agg != "" {
				switch agg {
				case "daily":
					aggregation = garmin.AggregationDaily
				case "weekly":
					aggregation = garmin.AggregationWeekly
				case "monthly":
					aggregation = garmin.AggregationMonthly
				case "yearly":
					aggregation = garmin.AggregationYearly
				default:
					return nil, fmt.Errorf("invalid aggregation: %s (valid: daily, weekly, monthly, yearly)", agg)
				}
			}
			return client.Metrics.GetHillScoreStats(ctx, start, end, aggregation)
		},
	},
	{
		Name:       "GetRacePredictionsDaily",
		Service:    "Metrics",
		Cassette:   "metrics",
		Path:       "/metrics-service/metrics/racepredictions/daily/{displayName}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "display_name", Type: endpoint.ParamTypeString, Required: false, Description: "User display name (defaults to current user)"},
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for daily race predictions (defaults to last 7 days)"},
		},
		CLICommand:    "metrics",
		CLISubcommand: "race-predictions-daily",
		MCPTool:       "metrics_get_race_predictions_daily",
		Short:         "Daily race-prediction history",
		Long: "Daily snapshots of predicted 5K/10K/half/marathon times over a date range (default last 7 days). " +
			"Use for 'how my race predictions changed'. For latest only use metrics_get_race_predictions.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			displayName, err := client.ResolveDisplayName(ctx, args.String("display_name"))
			if err != nil {
				return nil, err
			}
			end := time.Now()
			start := end.AddDate(0, 0, -7)
			if args.HasParam("start") {
				start = args.Date("start")
			}
			if args.HasParam("end") {
				end = args.Date("end")
			}
			return client.Metrics.GetRacePredictionsDaily(ctx, displayName, start, end)
		},
	},
	{
		Name:       "GetRacePredictionsMonthly",
		Service:    "Metrics",
		Cassette:   "metrics",
		Path:       "/metrics-service/metrics/racepredictions/monthly/{displayName}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "display_name", Type: endpoint.ParamTypeString, Required: false, Description: "User display name (defaults to current user)"},
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for monthly race predictions (defaults to last 7 days)"},
		},
		CLICommand:    "metrics",
		CLISubcommand: "race-predictions-monthly",
		MCPTool:       "metrics_get_race_predictions_monthly",
		Short:         "Monthly race-prediction history",
		Long: "Monthly snapshots of predicted race times over a date range (default last 7 days). " +
			"Use for long-term prediction trends. For current predictions use metrics_get_race_predictions.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			displayName, err := client.ResolveDisplayName(ctx, args.String("display_name"))
			if err != nil {
				return nil, err
			}
			end := time.Now()
			start := end.AddDate(0, 0, -7)
			if args.HasParam("start") {
				start = args.Date("start")
			}
			if args.HasParam("end") {
				end = args.Date("end")
			}
			return client.Metrics.GetRacePredictionsMonthly(ctx, displayName, start, end)
		},
	},
	{
		Name:       "GetMaxMetLatest",
		Service:    "Metrics",
		Cassette:   "metrics",
		Path:       "/metrics-service/metrics/maxmet/latest/{date}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for VO2 max snapshot (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "metrics",
		CLISubcommand: "vo2max",
		MCPTool:       "metrics_get_vo2max",
		Short:         "Latest VO2 max / fitness",
		Long: "Latest VO2 max / MET values (generic and cycling when present). Use for 'VO2 max', 'cardio fitness'. " +
			"Not training readiness (metrics_get_training_readiness) and not race predictions (metrics_get_race_predictions).",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Metrics.GetMaxMetLatest(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetMaxMetDaily",
		Service:    "Metrics",
		Cassette:   "metrics",
		Path:       "/metrics-service/metrics/maxmet/daily/{startDate}/{endDate}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for VO2 max data"},
		},
		CLICommand:    "metrics",
		CLISubcommand: "vo2max-range",
		Short:         "Get VO2 max range",
		Long:          "Get VO2 max / MET data for a date range",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			start := args.Date("start")
			end := args.Date("end")
			return client.Metrics.GetMaxMetDaily(ctx, start, end)
		},
	},
	{
		Name:       "GetTrainingStatusAggregated",
		Service:    "Metrics",
		Cassette:   "metrics",
		Path:       "/metrics-service/metrics/trainingstatus/aggregated/{date}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for training status (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "metrics",
		CLISubcommand: "training-status",
		MCPTool:       "metrics_get_training_status",
		Short:         "Training status / load overview",
		Long: "Aggregated training status: load balance, VO2 context, heat/altitude acclimation. " +
			"Use for 'training status', 'am I overreaching', load overview. For recover-or-push today prefer metrics_get_training_readiness.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Metrics.GetTrainingStatusAggregated(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetTrainingStatusDaily",
		Service:    "Metrics",
		Cassette:   "metrics",
		Path:       "/metrics-service/metrics/trainingstatus/daily/{date}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Date to get daily training status for (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "metrics",
		CLISubcommand: "training-status-daily",
		Short:         "Get daily training status",
		Long:          "Get daily training status data including weekly load and acute chronic workload ratio",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Metrics.GetTrainingStatusDaily(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetTrainingLoadBalance",
		Service:    "Metrics",
		Cassette:   "metrics",
		Path:       "/metrics-service/metrics/trainingloadbalance/latest/{date}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for load balance (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "metrics",
		CLISubcommand: "load-balance",
		MCPTool:       "metrics_get_training_load_balance",
		Short:         "Aerobic/anaerobic load balance",
		Long: "Latest training load balance: aerobic vs anaerobic load vs targets. " +
			"Use for 'load balance', training mix. Broader status overview: metrics_get_training_status.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Metrics.GetTrainingLoadBalance(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetHeatAltitudeAcclimation",
		Service:    "Metrics",
		Cassette:   "metrics",
		Path:       "/metrics-service/metrics/heataltitudeacclimation/latest/{date}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for acclimation snapshot (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "metrics",
		CLISubcommand: "acclimation",
		MCPTool:       "metrics_get_heat_altitude_acclimation",
		Short:         "Heat & altitude acclimation",
		Long: "Heat and altitude acclimation percentages and trends as of one day. " +
			"Use for 'heat acclimation', 'altitude acclimation'. Also summarized in metrics_get_training_status.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Metrics.GetHeatAltitudeAcclimation(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetRacePredictions",
		Service:    "Metrics",
		Cassette:   "metrics",
		Path:       "/metrics-service/metrics/racepredictions/latest/{displayName}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "display_name", Type: endpoint.ParamTypeString, Required: false, Description: "User display name (defaults to current user)"},
		},
		CLICommand:    "metrics",
		CLISubcommand: "race-predictions",
		MCPTool:       "metrics_get_race_predictions",
		Short:         "Current race time predictions",
		Long: "Latest predicted times for 5K, 10K, half marathon, and marathon from current fitness. " +
			"Use for 'what pace can I race', 'marathon prediction'. Not VO2 max — use metrics_get_vo2max.",
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
			displayName := args.String("display_name")
			if displayName == "" {
				// Auto-fetch display name from current user's social profile
				profile, err := client.UserProfile.GetSocialProfile(ctx)
				if err != nil {
					return nil, fmt.Errorf("failed to get display name: %w", err)
				}
				displayName = profile.DisplayName
			}
			return client.Metrics.GetRacePredictionsLatest(ctx, displayName)
		},
	},
}
