package definitions

import (
	"context"
	"fmt"

	"github.com/shotah/go-garmin/endpoint"
	"github.com/shotah/go-garmin/garmin"
)

// PersonalRecordsEndpoints defines personal-record endpoints.
var PersonalRecordsEndpoints = []endpoint.Endpoint{
	{
		Name:       "GetPersonalRecords",
		Service:    "PersonalRecords",
		Cassette:   "personalrecords",
		Path:       "/personalrecord-service/personalrecord/prs/{displayName}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "display_name", Type: endpoint.ParamTypeString, Required: false, Description: "User display name (defaults to current user)"},
		},
		CLICommand:    "records",
		CLISubcommand: "list",
		MCPTool:       "personal_records_get",
		Short:         "All-time personal bests",
		Long: "Personal records (PRs) for distances and activities: best times, dates. " +
			"Use for 'my PRs', 'fastest 5K'. Per-workout detail: activities_get after activities_list.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			displayName, err := client.ResolveDisplayName(ctx, args.String("display_name"))
			if err != nil {
				return nil, err
			}
			return client.PersonalRecords.List(ctx, displayName)
		},
	},
}
