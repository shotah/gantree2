package definitions

import (
	"context"
	"fmt"

	"github.com/shotah/go-garmin/endpoint"
	"github.com/shotah/go-garmin/garmin"
)

// BiometricEndpoints defines all biometric-related endpoints.
var BiometricEndpoints = []endpoint.Endpoint{
	{
		Name:          "GetLatestLactateThreshold",
		Service:       "Biometric",
		Cassette:      "biometric",
		Path:          "/biometric-service/biometric/latestLactateThreshold",
		HTTPMethod:    "GET",
		CLICommand:    "biometric",
		CLISubcommand: "lactate-threshold",
		MCPTool:       "biometric_get_lactate_threshold",
		Short:         "Latest lactate threshold",
		Long: "Latest lactate threshold speed and heart rate from Connect. " +
			"Use for 'LT pace', threshold training. Zone config: biometric_get_heart_rate_zones.",
		Handler: func(ctx context.Context, c any, _ *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Biometric.GetLatestLactateThreshold(ctx)
		},
	},
	{
		Name:          "GetCyclingFTP",
		Service:       "Biometric",
		Cassette:      "biometric",
		Path:          "/biometric-service/biometric/latestFunctionalThresholdPower/CYCLING",
		HTTPMethod:    "GET",
		CLICommand:    "biometric",
		CLISubcommand: "ftp",
		MCPTool:       "biometric_get_cycling_ftp",
		Short:         "Latest cycling FTP (watts)",
		Long: "Latest cycling Functional Threshold Power in watts. " +
			"Use for 'FTP', cycling power zones context. Per-ride zones: activities_get_power_zones.",
		Handler: func(ctx context.Context, c any, _ *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Biometric.GetCyclingFTP(ctx)
		},
	},
	{
		Name:       "GetPowerToWeight",
		Service:    "Biometric",
		Cassette:   "biometric",
		Path:       "/biometric-service/biometric/powerToWeight/latest/{date}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "date", Type: endpoint.ParamTypeDate, Required: false, Description: "Calendar day for power-to-weight (YYYY-MM-DD, defaults to today)"},
		},
		CLICommand:    "biometric",
		CLISubcommand: "power-weight",
		MCPTool:       "biometric_get_power_to_weight",
		Short:         "Running power-to-weight",
		Long: "Running power-to-weight ratio for one calendar day. " +
			"Use for 'w/kg', running power efficiency. Cycling FTP: biometric_get_cycling_ftp.",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Biometric.GetPowerToWeight(ctx, args.Date("date"))
		},
	},
	{
		Name:          "GetHeartRateZones",
		Service:       "Biometric",
		Cassette:      "biometric",
		Path:          "/biometric-service/heartRateZones/",
		HTTPMethod:    "GET",
		CLICommand:    "biometric",
		CLISubcommand: "hr-zones",
		MCPTool:       "biometric_get_heart_rate_zones",
		Short:         "HR zone definitions (all sports)",
		Long: "Heart-rate zone boundaries configured for each sport/activity type. " +
			"Use for 'my zone 2 range'. Time in zones on a workout: activities_get_hr_zones; daily HR: wellness_get_heart_rate.",
		Handler: func(ctx context.Context, c any, _ *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Biometric.GetHeartRateZones(ctx)
		},
	},
	{
		Name:       "GetLactateThresholdSpeedRange",
		Service:    "Biometric",
		Cassette:   "biometric",
		Path:       "/biometric-service/stats/lactateThresholdSpeed/range/{startDate}/{endDate}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for lactate threshold speed stats"},
		},
		CLICommand:    "biometric",
		CLISubcommand: "lt-speed-range",
		Short:         "Get lactate threshold speed range",
		Long:          "Get lactate threshold speed statistics for a date range",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			start := args.Date("start")
			end := args.Date("end")
			return client.Biometric.GetLactateThresholdSpeedRange(ctx, start, end)
		},
	},
	{
		Name:       "GetLactateThresholdHRRange",
		Service:    "Biometric",
		Cassette:   "biometric",
		Path:       "/biometric-service/stats/lactateThresholdHeartRate/range/{startDate}/{endDate}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for lactate threshold HR stats"},
		},
		CLICommand:    "biometric",
		CLISubcommand: "lt-hr-range",
		Short:         "Get lactate threshold HR range",
		Long:          "Get lactate threshold heart rate statistics for a date range",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			start := args.Date("start")
			end := args.Date("end")
			return client.Biometric.GetLactateThresholdHRRange(ctx, start, end)
		},
	},
	{
		Name:       "GetFTPRange",
		Service:    "Biometric",
		Cassette:   "biometric",
		Path:       "/biometric-service/stats/functionalThresholdPower/range/{startDate}/{endDate}",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "range", Type: endpoint.ParamTypeDateRange, Required: false, Description: "Date range for FTP stats"},
		},
		CLICommand:    "biometric",
		CLISubcommand: "ftp-range",
		Short:         "Get FTP range",
		Long:          "Get Functional Threshold Power statistics for a date range",
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			start := args.Date("start")
			end := args.Date("end")
			return client.Biometric.GetFTPRange(ctx, start, end)
		},
	},
}
