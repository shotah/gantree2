package definitions

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/shotah/go-garmin/endpoint"
	garmin "github.com/shotah/go-garmin/garmin"
)

// CourseEndpoints defines all course-related API endpoints.
var CourseEndpoints = []endpoint.Endpoint{
	{
		Name:       "ListOwnerCourses",
		Service:    "Courses",
		Cassette:   "courses",
		Path:       "/web-gateway/course/owner",
		HTTPMethod: "GET",

		CLICommand:    "courses",
		CLISubcommand: "list",
		MCPTool:       "courses_list",
		Short:         "My saved courses/routes",
		Long: "Courses and routes you own on Connect: distance, elevation, activity type, course_id. " +
			"Use for 'my courses', planning a route. Detail/GPX: courses_get.",

		Handler: func(ctx context.Context, c any, _ *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Courses.ListOwner(ctx)
		},
	},
	{
		Name:       "GetCourse",
		Service:    "Courses",
		Cassette:   "courses",
		Path:       "/course-service/course/{course_id}",
		HTTPMethod: "GET",

		Params: []endpoint.Param{
			{
				Name:        "course_id",
				Type:        endpoint.ParamTypeInt,
				Required:    true,
				Description: "Course ID from courses_list",
			},
		},

		CLICommand:    "courses",
		CLISubcommand: "get",
		MCPTool:       "courses_get",
		Short:         "Course detail + track",
		Long: "Full course/route metadata: distance, elevation, coordinates, activity type. " +
			"Use for 'course details', map path. List IDs: courses_list.",

		DependsOn: "ListOwnerCourses",
		ArgProvider: func(result any) map[string]any {
			resp, ok := result.(*garmin.CoursesForUserResponse)
			if !ok || len(resp.CoursesForUser) == 0 {
				return nil
			}
			return map[string]any{"course_id": resp.CoursesForUser[0].CourseID}
		},

		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Courses.Get(ctx, int64(args.Int("course_id")))
		},
	},
	{
		Name:    "DownloadCourseGPX",
		Service: "Courses",
		// Binary/GPS payload — cassette is gitignored (courses_download.yaml); not validated in CI.
		Cassette:   "none",
		Path:       "/course-service/course/gpx/{course_id}",
		HTTPMethod: "GET",
		RawOutput:  true,

		Params: []endpoint.Param{
			{
				Name:        "course_id",
				Type:        endpoint.ParamTypeInt,
				Required:    true,
				Description: "Course ID to download",
			},
		},

		CLICommand:    "courses",
		CLISubcommand: "download-gpx",
		Short:         "Download course as GPX",
		Long:          "Download a course/route as a GPX file. Output goes to stdout by default, use -o to write to a file.",

		DependsOn: "ListOwnerCourses",
		ArgProvider: func(result any) map[string]any {
			resp, ok := result.(*garmin.CoursesForUserResponse)
			if !ok || len(resp.CoursesForUser) == 0 {
				return nil
			}
			return map[string]any{"course_id": resp.CoursesForUser[0].CourseID}
		},

		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Courses.DownloadGPX(ctx, int64(args.Int("course_id")))
		},
	},
	{
		Name:    "DownloadCourseFIT",
		Service: "Courses",
		// Binary/GPS payload — cassette is gitignored (courses_download.yaml); not validated in CI.
		Cassette:   "none",
		Path:       "/course-service/course/fit/{course_id}/0",
		HTTPMethod: "GET",
		RawOutput:  true,

		Params: []endpoint.Param{
			{
				Name:        "course_id",
				Type:        endpoint.ParamTypeInt,
				Required:    true,
				Description: "Course ID to download",
			},
		},

		CLICommand:    "courses",
		CLISubcommand: "download-fit",
		Short:         "Download course as FIT",
		Long:          "Download a course/route as a FIT file. Output goes to stdout by default, use -o to write to a file.",

		DependsOn: "ListOwnerCourses",
		ArgProvider: func(result any) map[string]any {
			resp, ok := result.(*garmin.CoursesForUserResponse)
			if !ok || len(resp.CoursesForUser) == 0 {
				return nil
			}
			return map[string]any{"course_id": resp.CoursesForUser[0].CourseID}
		},

		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Courses.DownloadFIT(ctx, int64(args.Int("course_id")))
		},
	},
	{
		Name:       "ImportCourseGPX",
		Service:    "Courses",
		Cassette:   "none",
		Path:       "/course-service/course/import",
		HTTPMethod: "POST",

		Params: []endpoint.Param{
			{
				Name:        "file",
				Type:        endpoint.ParamTypeString,
				Required:    true,
				Description: "Path to GPX file to import",
			},
			{
				Name:        "activity-type",
				Type:        endpoint.ParamTypeInt,
				Required:    false,
				Description: "Activity type ID (e.g. 1=running, 3=hiking, 5=cycling)",
			},
			{
				Name:        "privacy",
				Type:        endpoint.ParamTypeInt,
				Required:    false,
				Description: "Privacy rule: 1=Public, 2=Private (default), 4=Group",
			},
		},

		CLICommand:    "courses",
		CLISubcommand: "import",
		Short:         "Import a GPX course",
		Long:          "Import a course/route from a GPX file to Garmin Connect",

		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			filePath := args.String("file")
			f, err := os.Open(filePath)
			if err != nil {
				return nil, fmt.Errorf("open file: %w", err)
			}
			defer f.Close()
			return client.Courses.Import(ctx, filepath.Base(filePath), f, args.Int("activity-type"), args.Int("privacy"))
		},
	},
	{
		Name:       "DeleteCourse",
		Service:    "Courses",
		Cassette:   "none",
		Path:       "/course-service/course/{course_id}",
		HTTPMethod: "DELETE",

		Params: []endpoint.Param{
			{
				Name:        "course_id",
				Type:        endpoint.ParamTypeInt,
				Required:    true,
				Description: "Course ID from courses_list to delete permanently",
			},
		},

		CLICommand:    "courses",
		CLISubcommand: "delete",
		MCPTool:       "courses_delete",
		Short:         "Remove a saved course",
		Long: "Permanently delete a course/route from Connect by course_id. " +
			"Use only when the user asks to delete a route — irreversible.",

		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			err := client.Courses.Delete(ctx, int64(args.Int("course_id")))
			if err != nil {
				return nil, err
			}
			return map[string]string{"status": "success"}, nil
		},
	},
}
