package definitions

import (
	"context"
	"fmt"

	"github.com/shotah/go-garmin/endpoint"
	"github.com/shotah/go-garmin/garmin"
)

// WeightEndpoints defines all weight-related endpoints.
var WeightEndpoints = []endpoint.Endpoint{
	{
		Name:       "GetDailyWeight",
		Service:    "Weight",
		Cassette:   "weight",
		Path:       "/weight-service/weight/dayview",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Weigh-in calendar day (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "weight",
		CLISubcommand: "daily",
		MCPTool:       "weight_get",
		Short:         "Scale weight + body composition",
		Long: "Index/scale weigh-in for a day: weight, BMI, body fat %, muscle mass, bone mass, body water. " +
			"Use for 'what's my weight', 'body composition', 'scale reading'. Not for steps, sleep, or activities.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Weight.GetDaily(ctx, args.Date("date"))
		},
	},
	{
		Name:       "GetWeightRange",
		Service:    "Weight",
		Cassette:   "weight",
		Path:       "/weight-service/weight/range",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for weight data"},
		},
		CLICommand:    "weight",
		CLISubcommand: "range",
		Short:         "Weight trend over a date range",
		Long:          "Weight summaries/averages over a date range. Use for 'weight this week/month'. For a single weigh-in prefer weight_get.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			start := args.Date("start")
			end := args.Date("end")
			return client.Weight.GetRange(ctx, start, end)
		},
	},
}
