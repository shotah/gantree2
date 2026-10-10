package definitions

import (
	"context"
	"errors"
	"fmt"

	"github.com/shotah/go-garmin/endpoint"
	"github.com/shotah/go-garmin/exercises"
)

// ExerciseEndpoints defines endpoints for the exercise library.
// These are static endpoints that don't require authentication.
var ExerciseEndpoints = []endpoint.Endpoint{
	{
		Name:          "ListExerciseCategories",
		Service:       "Exercises",
		Cassette:      "none",
		Path:          "/exercises/categories",
		HTTPMethod:    "GET",
		CLICommand:    "exercises",
		CLISubcommand: "categories",
		MCPTool:       "exercises_list_categories",
		Short:         "Strength exercise categories",
		Long: "Static catalog of exercise category codes (BENCH_PRESS, DEADLIFT, etc.). " +
			"Use to filter exercises_list when building workouts — no auth required.",
		Handler: func(_ context.Context, _ any, _ *endpoint.HandlerArgs) (any, error) {
			return exercises.Get().Categories(), nil
		},
	},
	{
		Name:          "ListMuscleGroups",
		Service:       "Exercises",
		Cassette:      "none",
		Path:          "/exercises/muscles",
		HTTPMethod:    "GET",
		CLICommand:    "exercises",
		CLISubcommand: "muscles",
		MCPTool:       "exercises_list_muscle_groups",
		Short:         "Muscle group codes",
		Long:          "Static muscle group codes (CHEST, BICEPS, etc.) for filtering exercises_list. No auth required.",
		Handler: func(_ context.Context, _ any, _ *endpoint.HandlerArgs) (any, error) {
			return exercises.Get().Muscles(), nil
		},
	},
	{
		Name:          "ListEquipmentTypes",
		Service:       "Exercises",
		Cassette:      "none",
		Path:          "/exercises/equipment",
		HTTPMethod:    "GET",
		CLICommand:    "exercises",
		CLISubcommand: "equipment",
		MCPTool:       "exercises_list_equipment",
		Short:         "Equipment type codes",
		Long:          "Static equipment codes (DUMBBELL, BARBELL, etc.) for filtering exercises_list. No auth required.",
		Handler: func(_ context.Context, _ any, _ *endpoint.HandlerArgs) (any, error) {
			return exercises.Get().Equipment(), nil
		},
	},
	{
		Name:       "ListExercises",
		Service:    "Exercises",
		Cassette:   "none",
		Path:       "/exercises",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "category", Type: endpoint.ParamTypeString, Required: false, Description: "Filter by category (e.g., BENCH_PRESS)"},
			{Name: "muscle", Type: endpoint.ParamTypeString, Required: false, Description: "Filter by muscle group (e.g., CHEST)"},
			{Name: "equipment", Type: endpoint.ParamTypeString, Required: false, Description: "Filter by equipment (e.g., DUMBBELL)"},
			{Name: "search", Type: endpoint.ParamTypeString, Required: false, Description: "Search exercise names"},
		},
		CLICommand:    "exercises",
		CLISubcommand: "list",
		MCPTool:       "exercises_list",
		Short:         "Search exercise library",
		Long: "Filter/search Garmin exercise library by category, muscle, equipment, or name (AND filters). " +
			"Use for workout JSON exercise keys. Detail: exercises_get.",
		Handler: func(_ context.Context, _ any, args *endpoint.HandlerArgs) (any, error) {
			category := args.String("category")
			muscle := args.String("muscle")
			equipment := args.String("equipment")
			search := args.String("search")
			return exercises.Get().Filter(category, muscle, equipment, search), nil
		},
	},
	{
		Name:       "GetExercise",
		Service:    "Exercises",
		Cassette:   "none",
		Path:       "/exercises/:key",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "key", Type: endpoint.ParamTypeString, Required: true, Description: "Exercise key (e.g., BARBELL_BENCH_PRESS)"},
		},
		CLICommand:    "exercises",
		CLISubcommand: "get",
		MCPTool:       "exercises_get",
		Short:         "Exercise detail by key",
		Long: "Exercise metadata for a library key (e.g. BARBELL_BENCH_PRESS); may return multiple if key spans categories. " +
			"Use after exercises_list. Logged sets in activities: activities_get_exercise_sets.",
		Handler: func(_ context.Context, _ any, args *endpoint.HandlerArgs) (any, error) {
			key := args.String("key")
			if key == "" {
				return nil, errors.New("key is required")
			}
			result := exercises.Get().ByKey(key)
			if len(result) == 0 {
				return nil, fmt.Errorf("exercise not found: %s", key)
			}
			return result, nil
		},
	},
}
