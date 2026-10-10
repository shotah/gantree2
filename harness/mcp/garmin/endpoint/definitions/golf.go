package definitions

import (
	"context"
	"fmt"

	"github.com/shotah/go-garmin/endpoint"
	"github.com/shotah/go-garmin/garmin"
)

// GolfEndpoints defines Garmin Golf scorecard endpoints.
var GolfEndpoints = []endpoint.Endpoint{
	{
		Name:       "ListGolfScorecards",
		Service:    "Golf",
		Cassette:   "golf",
		Path:       "/gcs-golfcommunity/api/v2/scorecard/summary",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "start", Type: endpoint.ParamTypeInt, Required: false, Description: "Starting index (0-based, defaults to 0)"},
			{Name: "limit", Type: endpoint.ParamTypeInt, Required: false, Description: "Maximum results (defaults to 20)"},
		},
		CLICommand:    "golf",
		CLISubcommand: "list",
		MCPTool:       "golf_list_scorecards",
		Short:         "Recent golf rounds",
		Long: "Paginated golf scorecard summaries (course, date, score). " +
			"Use for 'my golf rounds', 'recent golf'; scorecard_id for golf_get_scorecard.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Golf.ListScorecards(ctx, args.IntOrDefault("start", 0), args.IntOrDefault("limit", 20))
		},
	},
	{
		Name:       "GetGolfScorecard",
		Service:    "Golf",
		Cassette:   "golf",
		Path:       "/gcs-golfcommunity/api/v2/scorecard/detail",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "scorecard_id", Type: endpoint.ParamTypeInt, Required: true, Description: "Scorecard ID from golf_list_scorecards"},
		},
		CLICommand:    "golf",
		CLISubcommand: "get",
		MCPTool:       "golf_get_scorecard",
		Short:         "Full scorecard for one round",
		Long: "Hole-by-hole golf scorecard detail for a scorecard_id including longest-shot distance when tracked. " +
			"Use for 'how did I play', score breakdown. Shot traces: golf_get_shot_data.",
		DependsOn: "ListGolfScorecards",
		ArgProvider: func(result any) map[string]any {
			summaries, ok := result.(*garmin.GolfScorecardSummaries)
			if !ok || summaries.FirstID() == 0 {
				return nil
			}
			return map[string]any{"scorecard_id": summaries.FirstID()}
		},
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Golf.GetScorecard(ctx, int64(args.Int("scorecard_id")))
		},
	},
	{
		Name:       "GetGolfShotData",
		Service:    "Golf",
		Cassette:   "golf",
		Path:       "/gcs-golfcommunity/api/v2/shot/scorecard/{scorecard_id}/hole",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "scorecard_id", Type: endpoint.ParamTypeInt, Required: true, Description: "Scorecard ID from golf_list_scorecards"},
			{Name: "holes", Type: endpoint.ParamTypeString, Required: false, Description: "Comma-separated hole numbers (defaults to 1-18)"},
		},
		CLICommand:    "golf",
		CLISubcommand: "shots",
		MCPTool:       "golf_get_shot_data",
		Short:         "Shot-by-shot on holes",
		Long: "Per-shot data for selected holes on a scorecard (Approach/CT10 tracking). " +
			"Use for 'club distances', shot dispersion. Summary scores: golf_get_scorecard.",
		DependsOn: "ListGolfScorecards",
		ArgProvider: func(result any) map[string]any {
			summaries, ok := result.(*garmin.GolfScorecardSummaries)
			if !ok || summaries.FirstID() == 0 {
				return nil
			}
			return map[string]any{"scorecard_id": summaries.FirstID()}
		},
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Golf.GetShotData(ctx, int64(args.Int("scorecard_id")), args.String("holes"))
		},
	},
}
