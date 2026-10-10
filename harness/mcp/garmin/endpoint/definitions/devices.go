package definitions

import (
	"context"
	"fmt"

	"github.com/shotah/go-garmin/endpoint"
	"github.com/shotah/go-garmin/garmin"
)

// DeviceEndpoints defines all device-related endpoints.
var DeviceEndpoints = []endpoint.Endpoint{
	{
		Name:          "ListDevices",
		Service:       "Devices",
		Cassette:      "devices",
		Path:          "/device-service/deviceregistration/devices",
		HTTPMethod:    "GET",
		CLICommand:    "devices",
		CLISubcommand: "list",
		MCPTool:       "devices_list",
		Short:         "Registered watches & devices",
		Long: "Garmin devices on your account: model, device_id, sync status, capabilities. " +
			"Use for 'what watch do I have', picking device_id for devices_get_settings.",
		Handler: func(ctx context.Context, c any, _ *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Devices.GetDevices(ctx)
		},
	},
	{
		Name:       "GetDeviceSettings",
		Service:    "Devices",
		Cassette:   "devices",
		Path:       "/device-service/deviceservice/device-info/settings",
		HTTPMethod: "GET",
		Params: []endpoint.Param{
			{Name: "device_id", Type: endpoint.ParamTypeInt, Required: true, Description: "Device ID from devices_list"},
		},
		CLICommand:    "devices",
		CLISubcommand: "settings",
		MCPTool:       "devices_get_settings",
		Short:         "Watch settings & preferences",
		Long: "Device settings for one device_id: alarms, activity tracking, display options. " +
			"Use for 'watch settings', device configuration.",
		DependsOn: "ListDevices",
		ArgProvider: func(result any) map[string]any {
			devices, ok := result.([]garmin.Device)
			if !ok || len(devices) == 0 {
				return nil
			}
			return map[string]any{"device_id": devices[0].DeviceID}
		},
		Handler: func(ctx context.Context, c any, args *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.Devices.GetSettings(ctx, int64(args.Int("device_id")))
		},
	},
}
