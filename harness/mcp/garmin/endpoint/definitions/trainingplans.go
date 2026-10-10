package definitions

import (
	"context"
	"fmt"

	"github.com/shotah/go-garmin/endpoint"
	"github.com/shotah/go-garmin/garmin"
)

// TrainingPlanEndpoints defines training plan / Garmin Coach endpoints.
var TrainingPlanEndpoints = []endpoint.Endpoint{
	{
		Name:          "ListTrainingPlans",
		Service:       "TrainingPlans",
		Cassette:      "trainingplans",
		Path:          "/trainingplan-service/trainingplan/plans",
		HTTPMethod:    "GET",
		CLICommand:    "plans",
		CLISubcommand: "list",
		MCPTool:       "training_plans_list",
		Short:         "Garmin Coach / training plans",
		Long: "Training plans on your account (Garmin Coach, phased plans) with plan_id for detail tools. " +
			"Use for 'my training plan', 'what plan am I on'.",
		Handler: func(ctx context.Context, c any, _ *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.TrainingPlans.List(ctx)
		},
	},
	{
		Name:       "GetTrainingPlanPhased",
		Service:    "TrainingPlans",
		Cassette:   "trainingplans",
		Path:       "/trainingplan-service/trainingplan/phased/{planId}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "plan_id", Type: endpoint.ParamTypeInt, Required: true, Description: "Training plan ID from training_plans_list"},
		},
		CLICommand:    "plans",
		CLISubcommand: "phased",
		MCPTool:       "training_plans_get_phased",
		Short:         "Phased plan structure",
		Long: "Phased training plan detail: phases, workouts, schedule by plan_id. " +
			"Use for structured multi-phase plans. Adaptive Coach plan: training_plans_get_adaptive.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.TrainingPlans.GetPhased(ctx, int64(args.Int("plan_id")))
		},
	},
	{
		Name:       "GetTrainingPlanAdaptive",
		Service:    "TrainingPlans",
		Cassette:   "trainingplans",
		Path:       "/trainingplan-service/trainingplan/fbt-adaptive/{planId}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "plan_id", Type: endpoint.ParamTypeInt, Required: true, Description: "Training plan ID from training_plans_list"},
		},
		CLICommand:    "plans",
		CLISubcommand: "adaptive",
		MCPTool:       "training_plans_get_adaptive",
		Short:         "Garmin Coach adaptive plan",
		Long: "FBT adaptive (Garmin Coach) plan detail: upcoming workouts and adjustments by plan_id. " +
			"Use for 'Coach plan this week'. Fixed phased plan: training_plans_get_phased.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.TrainingPlans.GetAdaptive(ctx, int64(args.Int("plan_id")))
		},
	},
}
