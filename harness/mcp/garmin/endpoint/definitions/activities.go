package definitions

import (
	"context"
	"fmt"

	"github.com/shotah/go-garmin/endpoint"
	"github.com/shotah/go-garmin/garmin"
)

// ActivityEndpoints defines all activity-related endpoints.
var ActivityEndpoints = []endpoint.Endpoint{
	{
		Name:          "GetActivityTypes",
		Service:       "Activities",
		Cassette:      "activities",
		Path:          "/activity-service/activity/activityTypes",
		HTTPMethod:    "GET",
		CLICommand:    "activities",
		CLISubcommand: "types",
		MCPTool:       "activities_get_types",
		Short:         "Activity type catalog",
		Long: "All Garmin activity type IDs and labels (run, ride, climb, etc.). " +
			"Use when filtering activities_list or interpreting activityType fields — not for workout history.",
		Handler: func(ctx context.Context, c any, _ *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Activities.GetActivityTypes(ctx)
		},
	},
	{
		Name:       "ListActivities",
		Service:    "Activities",
		Cassette:   "activities",
		Path:       "/activitylist-service/activities/search/activities",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "start", Type: endpoint.ParamTypeInt, Required: false, Description: "Starting index (0-based, defaults to 0)"},
			{Name: "limit", Type: endpoint.ParamTypeInt, Required: false, Description: "Maximum number of activities to return (defaults to 20)"},
		},
		CLICommand:    "activities",
		CLISubcommand: "list",
		MCPTool:       "activities_list",
		Short:         "List recent workouts/activities",
		Long: "List recent Garmin activities (runs, rides, climbs, etc.) with pagination; returns activity_id for follow-ups. " +
			"Use for 'what did I do', 'workouts this week', activity history. " +
			"Climbing list items may include falls/sends; per-route grades need activities_get_typed_splits; session fall totals need activities_get_split_summaries.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			opts := &garmin.ListOptions{
				Start: args.Int("start"),
				Limit: args.Int("limit"),
			}
			if opts.Limit == 0 {
				opts.Limit = 20
			}
			activities, err := client.Activities.List(ctx, opts)
			if err != nil {
				return nil, err
			}
			items := make([]garmin.ActivityListItem, len(activities))
			for i := range activities {
				items[i] = activities[i].ToListItem()
			}
			return items, nil
		},
	},
	{
		Name:       "GetActivity",
		Service:    "Activities",
		Cassette:   "activities",
		Path:       "/activity-service/activity/{activityId}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "activity_id", Type: endpoint.ParamTypeInt, Required: true, Description: "The activity ID"},
		},
		CLICommand:    "activities",
		CLISubcommand: "get",
		MCPTool:       "activities_get",
		Short:         "One activity by ID (summary)",
		Long: "Detailed summary for one activity by activity_id from activities_list: metadata, distance/time/HR, and overview splits. " +
			"Use when the user asks about a specific workout. For climbing per-route grades use activities_get_typed_splits; for fall/send aggregates use activities_get_split_summaries.",
		DependsOn: "ListActivities",
		ArgProvider: func(result any) map[string]any {
			items, ok := result.([]garmin.ActivityListItem)
			if !ok || len(items) == 0 {
				return nil
			}
			return map[string]any{"activity_id": items[0].ActivityID}
		},
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Activities.Get(ctx, int64(args.Int("activity_id")))
		},
	},
	{
		Name:       "GetActivityWeather",
		Service:    "Activities",
		Cassette:   "activities",
		Path:       "/activity-service/activity/{activityId}/weather",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "activity_id", Type: endpoint.ParamTypeInt, Required: true, Description: "Activity ID from activities_list"},
		},
		CLICommand:    "activities",
		CLISubcommand: "weather",
		MCPTool:       "activities_get_weather",
		Short:         "Weather during a workout",
		Long: "Weather at activity time: temperature, humidity, wind, conditions. " +
			"Use for 'what was the weather on my run'. Requires activity_id from activities_list.",
		DependsOn: "ListActivities",
		ArgProvider: func(result any) map[string]any {
			items, ok := result.([]garmin.ActivityListItem)
			if !ok || len(items) == 0 {
				return nil
			}
			return map[string]any{"activity_id": items[0].ActivityID}
		},
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Activities.GetWeather(ctx, int64(args.Int("activity_id")))
		},
	},
	{
		Name:       "GetActivitySplits",
		Service:    "Activities",
		Cassette:   "activities",
		Path:       "/activity-service/activity/{activityId}/splits",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "activity_id", Type: endpoint.ParamTypeInt, Required: true, Description: "Activity ID from activities_list"},
		},
		CLICommand:    "activities",
		CLISubcommand: "splits",
		MCPTool:       "activities_get_splits",
		Short:         "Lap splits (pace/HR/elev)",
		Long: "Lap or split table for one activity: pace, heart rate, elevation per segment. " +
			"Use for 'splits on my run', mile times. Climbing routes: prefer activities_get_typed_splits.",
		DependsOn: "ListActivities",
		ArgProvider: func(result any) map[string]any {
			items, ok := result.([]garmin.ActivityListItem)
			if !ok || len(items) == 0 {
				return nil
			}
			return map[string]any{"activity_id": items[0].ActivityID}
		},
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Activities.GetSplits(ctx, int64(args.Int("activity_id")))
		},
	},
	{
		Name:       "GetActivityDetails",
		Service:    "Activities",
		Cassette:   "activities",
		Path:       "/activity-service/activity/{activityId}/details",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "activity_id", Type: endpoint.ParamTypeInt, Required: true, Description: "The activity ID"},
		},
		CLICommand:    "activities",
		CLISubcommand: "details",
		MCPTool:       "activities_get_details",
		Short:         "Activity time-series metrics",
		Long: "Extended time-series metrics for an activity_id (samples over the workout). " +
			"Use when you need charts/samples beyond activities_get's summary. Prefer activities_get first for a normal workout recap.",
		DependsOn: "ListActivities",
		ArgProvider: func(result any) map[string]any {
			items, ok := result.([]garmin.ActivityListItem)
			if !ok || len(items) == 0 {
				return nil
			}
			return map[string]any{"activity_id": items[0].ActivityID}
		},
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Activities.GetDetails(ctx, int64(args.Int("activity_id")), nil)
		},
	},
	{
		Name:       "GetActivityHRTimeInZones",
		Service:    "Activities",
		Cassette:   "activities",
		Path:       "/activity-service/activity/{activityId}/hrTimeInZones",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "activity_id", Type: endpoint.ParamTypeInt, Required: true, Description: "Activity ID from activities_list"},
		},
		CLICommand:    "activities",
		CLISubcommand: "hr-zones",
		MCPTool:       "activities_get_hr_zones",
		Short:         "HR time in zones (workout)",
		Long: "Time spent in each heart-rate zone during one activity. " +
			"Use for 'zone distribution on my ride'. All-day zones: wellness_get_heart_rate; zone config: biometric_get_heart_rate_zones.",
		DependsOn: "ListActivities",
		ArgProvider: func(result any) map[string]any {
			items, ok := result.([]garmin.ActivityListItem)
			if !ok || len(items) == 0 {
				return nil
			}
			return map[string]any{"activity_id": items[0].ActivityID}
		},
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Activities.GetHRTimeInZones(ctx, int64(args.Int("activity_id")))
		},
	},
	{
		Name:       "GetActivityPowerTimeInZones",
		Service:    "Activities",
		Cassette:   "activities",
		Path:       "/activity-service/activity/{activityId}/powerTimeInZones",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "activity_id", Type: endpoint.ParamTypeInt, Required: true, Description: "Activity ID from activities_list"},
		},
		CLICommand:    "activities",
		CLISubcommand: "power-zones",
		MCPTool:       "activities_get_power_zones",
		Short:         "Power time in zones (workout)",
		Long: "Time in cycling power zones for one activity. " +
			"Use for 'power zones on my ride'. FTP snapshot: biometric_get_cycling_ftp.",
		DependsOn: "ListActivities",
		ArgProvider: func(result any) map[string]any {
			items, ok := result.([]garmin.ActivityListItem)
			if !ok || len(items) == 0 {
				return nil
			}
			return map[string]any{"activity_id": items[0].ActivityID}
		},
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Activities.GetPowerTimeInZones(ctx, int64(args.Int("activity_id")))
		},
	},
	{
		Name:       "GetActivityExerciseSets",
		Service:    "Activities",
		Cassette:   "activities",
		Path:       "/activity-service/activity/{activityId}/exerciseSets",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "activity_id", Type: endpoint.ParamTypeInt, Required: true, Description: "Activity ID from activities_list"},
		},
		CLICommand:    "activities",
		CLISubcommand: "exercise-sets",
		MCPTool:       "activities_get_exercise_sets",
		Short:         "Strength sets & reps",
		Long: "Exercise sets for a strength-training activity: exercises, reps, weight. " +
			"Use for 'what did I lift', gym set details. Exercise library IDs: exercises_list.",
		DependsOn: "ListActivities",
		ArgProvider: func(result any) map[string]any {
			items, ok := result.([]garmin.ActivityListItem)
			if !ok || len(items) == 0 {
				return nil
			}
			return map[string]any{"activity_id": items[0].ActivityID}
		},
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Activities.GetExerciseSets(ctx, int64(args.Int("activity_id")))
		},
	},
	{
		Name:       "GetActivityTypedSplits",
		Service:    "Activities",
		Cassette:   "activities",
		Path:       "/activity-service/activity/{activityId}/typedsplits",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "activity_id", Type: endpoint.ParamTypeInt, Required: true, Description: "The activity ID"},
		},
		CLICommand:    "activities",
		CLISubcommand: "typed-splits",
		MCPTool:       "activities_get_typed_splits",
		Short:         "Per-route climbing splits / grades",
		Long: "Typed splits for an activity_id. For indoor climbing/bouldering: per-route CLIMB_ACTIVE|CLIMB_REST, " +
			"status CLIMB_COMPLETED|CLIMB_ATTEMPTED, gradeValue (VERMIN/YDS/FONT). " +
			"Use for 'what grades did I climb', sends vs attempts. Session fall totals are on activities_get_split_summaries (numFalls).",
		DependsOn: "ListActivities",
		ArgProvider: func(result any) map[string]any {
			items, ok := result.([]garmin.ActivityListItem)
			if !ok || len(items) == 0 {
				return nil
			}
			return map[string]any{"activity_id": items[0].ActivityID}
		},
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Activities.GetTypedSplits(ctx, int64(args.Int("activity_id")))
		},
	},
	{
		Name:       "GetActivitySplitSummaries",
		Service:    "Activities",
		Cassette:   "activities",
		Path:       "/activity-service/activity/{activityId}/split_summaries",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "activity_id", Type: endpoint.ParamTypeInt, Required: true, Description: "The activity ID"},
		},
		CLICommand:    "activities",
		CLISubcommand: "split-summaries",
		MCPTool:       "activities_get_split_summaries",
		Short:         "Activity split aggregates (falls/sends)",
		Long: "Split summaries aggregated by type for an activity_id. For climbing CLIMB_ACTIVE: numFalls (watch falls), " +
			"numClimbSends, numClimbsCompleted, maxGradeValue. Use for session fall/send totals; " +
			"use activities_get_typed_splits for per-route grades/status.",
		DependsOn: "ListActivities",
		ArgProvider: func(result any) map[string]any {
			items, ok := result.([]garmin.ActivityListItem)
			if !ok || len(items) == 0 {
				return nil
			}
			return map[string]any{"activity_id": items[0].ActivityID}
		},
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Activities.GetSplitSummaries(ctx, int64(args.Int("activity_id")))
		},
	},
	{
		Name:       "GetActivityGear",
		Service:    "Activities",
		Cassette:   "activities",
		Path:       "/gear-service/gear/filterGear?activityId={activityId}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "activity_id", Type: endpoint.ParamTypeInt, Required: true, Description: "Activity ID from activities_list"},
		},
		CLICommand:    "activities",
		CLISubcommand: "gear",
		MCPTool:       "activities_get_gear",
		Short:         "Gear used on activity",
		Long: "Shoes, bike, or other gear linked to one activity. " +
			"Use for 'what shoes did I wear on that run'.",
		DependsOn: "ListActivities",
		ArgProvider: func(result any) map[string]any {
			items, ok := result.([]garmin.ActivityListItem)
			if !ok || len(items) == 0 {
				return nil
			}
			return map[string]any{"activity_id": items[0].ActivityID}
		},
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Activities.GetGear(ctx, int64(args.Int("activity_id")))
		},
	},
}
