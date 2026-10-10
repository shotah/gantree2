package definitions

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/shotah/go-garmin/endpoint"
	"github.com/shotah/go-garmin/garmin"
)

// FitnessAgeEndpoints defines all fitness age-related endpoints.
var FitnessAgeEndpoints = []endpoint.Endpoint{
	{
		Name:       "GetFitnessAgeDaily",
		Service:    "FitnessAge",
		Cassette:   "fitnessage",
		Path:       "/fitnessage-service/fitnessage/{date}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for fitness age (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "fitnessage",
		CLISubcommand: "daily",
		MCPTool:       "fitness_age_get",
		Short:         "Fitness age vs real age",
		Long: "Fitness Age for one day: chronological age, fitness age, achievable target, contributors. " +
			"Use for 'fitness age', 'am I younger than my age'. Trends: fitness_age_get_stats.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.FitnessAge.GetDaily(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetFitnessAgeStats",
		Service:    "FitnessAge",
		Cassette:   "fitnessage",
		Path:       "/fitnessage-service/stats/daily/{startDate}/{endDate}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for fitness age data (default: last 7 days, max 28 days)"},
		},
		CLICommand:    "fitnessage",
		CLISubcommand: "stats",
		MCPTool:       "fitness_age_get_stats",
		Short:         "Fitness age over time",
		Long: "Daily fitness age, achievable age, RHR, BMI, vigorous-activity days over a range (default 7 days, max 28). " +
			"Use for 'fitness age trend'. Single day: fitness_age_get.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}

			// Default: last 7 days
			end := time.Now()
			start := end.AddDate(0, 0, -7)
			if args.HasParam("end") {
				end = args.Date("end")
			}
			if args.HasParam("start") {
				start = args.Date("start")
			}

			// Validate: max 28 days
			days := int(end.Sub(start).Hours() / 24)
			if days > 28 {
				return nil, fmt.Errorf("date range must be 28 days or less (got %d days)", days)
			}
			if days < 1 {
				return nil, errors.New("date range must be at least 1 day")
			}

			return client.FitnessAge.GetStatsDaily(ctx, start, end)
		},
	},
}
