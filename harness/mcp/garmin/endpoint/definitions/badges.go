package definitions

import (
	"context"
	"fmt"

	"github.com/shotah/go-garmin/endpoint"
	"github.com/shotah/go-garmin/garmin"
)

// BadgeEndpoints defines badge and challenge endpoints.
var BadgeEndpoints = []endpoint.Endpoint{
	{
		Name:          "GetEarnedBadges",
		Service:       "Badges",
		Cassette:      "badges",
		Path:          "/badge-service/badge/earned",
		HTTPMethod:    "GET",
		CLICommand:    "badges",
		CLISubcommand: "earned",
		MCPTool:       "badges_get_earned",
		Short:         "Badges you've earned",
		Long: "Badges already earned on Connect (activity, milestone, etc.). " +
			"Use for 'my badges', achievements. Not yet earned: badges_get_available.",
		Handler: func(ctx context.Context, c any, _ *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Badges.ListEarned(ctx)
		},
	},
	{
		Name:          "GetAvailableBadges",
		Service:       "Badges",
		Cassette:      "badges",
		Path:          "/badge-service/badge/available",
		HTTPMethod:    "GET",
		CLICommand:    "badges",
		CLISubcommand: "available",
		MCPTool:       "badges_get_available",
		Short:         "Badges you can still earn",
		Long: "Badges available to earn (including exclusive). " +
			"Use for 'badges left to get'. Already earned: badges_get_earned.",
		Handler: func(ctx context.Context, c any, _ *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Badges.ListAvailable(ctx)
		},
	},
	{
		Name:       "GetCompletedBadgeChallenges",
		Service:    "Badges",
		Cassette:   "badges",
		Path:       "/badgechallenge-service/badgeChallenge/completed",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "start", Type: endpoint.ParamTypeInt, Required: false, Description: "Starting index (0-based, defaults to 0)"},
			{Name: "limit", Type: endpoint.ParamTypeInt, Required: false, Description: "Maximum number of challenges to return (defaults to 20)"},
		},
		CLICommand:    "badges",
		CLISubcommand: "challenges-completed",
		MCPTool:       "badges_get_completed_challenges",
		Short:         "Finished badge challenges",
		Long:          "Completed badge challenges (paginated). Use for 'challenges I finished'. Open ones: badges_get_open_challenges.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Badges.ListCompletedChallenges(ctx, args.IntOrDefault("start", 0), args.IntOrDefault("limit", 20))
		},
	},
	{
		Name:       "GetAvailableBadgeChallenges",
		Service:    "Badges",
		Cassette:   "badges",
		Path:       "/badgechallenge-service/badgeChallenge/available",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "start", Type: endpoint.ParamTypeInt, Required: false, Description: "Starting index (0-based, defaults to 0)"},
			{Name: "limit", Type: endpoint.ParamTypeInt, Required: false, Description: "Maximum number of challenges to return (defaults to 20)"},
		},
		CLICommand:    "badges",
		CLISubcommand: "challenges-available",
		MCPTool:       "badges_get_available_challenges",
		Short:         "Joinable badge challenges",
		Long:          "Badge challenges you can join (paginated). Use for 'new challenges'. In progress: badges_get_open_challenges.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Badges.ListAvailableChallenges(ctx, args.IntOrDefault("start", 0), args.IntOrDefault("limit", 20))
		},
	},
	{
		Name:       "GetNonCompletedBadgeChallenges",
		Service:    "Badges",
		Cassette:   "badges",
		Path:       "/badgechallenge-service/badgeChallenge/non-completed",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "start", Type: endpoint.ParamTypeInt, Required: false, Description: "Starting index (0-based, defaults to 0)"},
			{Name: "limit", Type: endpoint.ParamTypeInt, Required: false, Description: "Maximum number of challenges to return (defaults to 20)"},
		},
		CLICommand:    "badges",
		CLISubcommand: "challenges-open",
		MCPTool:       "badges_get_open_challenges",
		Short:         "Active badge challenges",
		Long:          "Open (not completed) badge challenges in progress (paginated). Use for 'challenges I'm doing'. Done: badges_get_completed_challenges.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Badges.ListNonCompletedChallenges(ctx, args.IntOrDefault("start", 0), args.IntOrDefault("limit", 20))
		},
	},
	{
		Name:       "GetVirtualChallengesInProgress",
		Service:    "Badges",
		Cassette:   "badges",
		Path:       "/badgechallenge-service/virtualChallenge/inProgress",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "start", Type: endpoint.ParamTypeInt, Required: false, Description: "Starting index (0-based, defaults to 0)"},
			{Name: "limit", Type: endpoint.ParamTypeInt, Required: false, Description: "Maximum number of challenges to return (defaults to 20)"},
		},
		CLICommand:    "badges",
		CLISubcommand: "virtual",
		MCPTool:       "badges_get_virtual_in_progress",
		Short:         "Virtual challenges in progress",
		Long: "In-progress virtual challenges (paginated): progress toward distance/goal targets. " +
			"Use for 'virtual challenge status'.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Badges.ListVirtualChallengesInProgress(ctx, args.IntOrDefault("start", 0), args.IntOrDefault("limit", 20))
		},
	},
	{
		Name:       "GetAdHocHistoricalChallenges",
		Service:    "Badges",
		Cassette:   "badges",
		Path:       "/adhocchallenge-service/adHocChallenge/historical",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "start", Type: endpoint.ParamTypeInt, Required: false, Description: "Starting index (0-based, defaults to 0)"},
			{Name: "limit", Type: endpoint.ParamTypeInt, Required: false, Description: "Maximum number of challenges to return (defaults to 20)"},
		},
		CLICommand:    "badges",
		CLISubcommand: "adhoc",
		MCPTool:       "badges_get_adhoc_historical",
		Short:         "Past ad-hoc challenges",
		Long:          "Historical ad-hoc challenges (paginated). Use for past one-off Connect challenges.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Badges.ListAdHocHistorical(ctx, args.IntOrDefault("start", 0), args.IntOrDefault("limit", 20))
		},
	},
}
