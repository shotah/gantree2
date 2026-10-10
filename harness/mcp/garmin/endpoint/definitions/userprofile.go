package definitions

import (
	"context"
	"fmt"

	"github.com/shotah/go-garmin/endpoint"
	"github.com/shotah/go-garmin/garmin"
)

// UserProfileEndpoints defines all user profile-related endpoints.
var UserProfileEndpoints = []endpoint.Endpoint{
	{
		Name:          "GetSocialProfile",
		Service:       "UserProfile",
		Cassette:      "userprofile",
		Path:          "/userprofile-service/socialProfile",
		HTTPMethod:    "GET",
		CLICommand:    "profile",
		CLISubcommand: "social",
		MCPTool:       "profile_get_social",
		Short:         "Display name & social profile",
		Long: "Social profile: display_name (needed for some APIs), bio, visibility. " +
			"Use for 'my Garmin display name' or before tools requiring display_name.",
		Handler: func(ctx context.Context, c any, _ *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.UserProfile.GetSocialProfile(ctx)
		},
	},
	{
		Name:          "GetUserSettings",
		Service:       "UserProfile",
		Cassette:      "userprofile",
		Path:          "/userprofile-service/userprofile/user-settings",
		HTTPMethod:    "GET",
		CLICommand:    "profile",
		CLISubcommand: "settings",
		MCPTool:       "profile_get_user_settings",
		Short:         "Account & health settings",
		Long: "User settings: personal data, sleep preferences, units-related options. " +
			"Use for 'my profile settings', height/weight prefs — not daily metrics.",
		Handler: func(ctx context.Context, c any, _ *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.UserProfile.GetUserSettings(ctx)
		},
	},
	{
		Name:          "GetProfileSettings",
		Service:       "UserProfile",
		Cassette:      "userprofile",
		Path:          "/userprofile-service/userprofile/settings",
		HTTPMethod:    "GET",
		CLICommand:    "profile",
		CLISubcommand: "display",
		MCPTool:       "profile_get_settings",
		Short:         "Locale, units, formats",
		Long: "Profile display settings: locale, date/time formats, measurement units. " +
			"Use for 'what units am I using', display preferences.",
		Handler: func(ctx context.Context, c any, _ *endpoint.HandlerArgs) (any, error) {
			client, ok := c.(*garmin.Client)
			if !ok {
				return nil, fmt.Errorf("handler received invalid client type: %T, expected *garmin.Client", c)
			}
			return client.UserProfile.GetProfileSettings(ctx)
		},
	},
}
