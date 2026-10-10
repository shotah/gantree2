package mcp

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"

	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/shotah/google-health-mcp/internal/ghealth"
)

// Host server id for ai-gantry is "ghealth" → tools appear as ghealth__{tool}.
const ServerName = "google-health-mcp"

// ServerVersion is set at build time via ldflags.
var ServerVersion = "dev"

// HealthAPI is the Google Health surface used by tools (mockable in tests).
type HealthAPI interface {
	SleepGet(ctx context.Context, req ghealth.SleepGetRequest) (*ghealth.SleepListResult, error)
	ActivitiesList(ctx context.Context, req ghealth.ActivitiesListRequest) (*ghealth.ActivitiesListResult, error)
	ActivitiesGet(ctx context.Context, id string) (*ghealth.Activity, error)
	HeartRateGet(ctx context.Context, req ghealth.HeartRateRequest) (*ghealth.HeartRateListResult, error)
	HRVGet(ctx context.Context, req ghealth.HRVRequest) (*ghealth.HRVListResult, error)
	WeightGet(ctx context.Context, req ghealth.WeightRequest) (*ghealth.WeightResult, error)
	ProfileGet(ctx context.Context) (*ghealth.Profile, error)
	AccountStatus() map[string]any
}

// Server is the stdio MCP Google Health surface.
type Server struct {
	Log    *log.Logger
	Client HealthAPI
}

// New creates an MCP server. Client may be nil until Run.
func New(client HealthAPI) *Server {
	return &Server{
		Log:    log.New(os.Stderr, "google-health-mcp: ", log.LstdFlags|log.Lmsgprefix),
		Client: client,
	}
}

// RegisteredToolNames returns tool names in registration order.
func RegisteredToolNames() []string {
	return []string{
		"sleep_get",
		"activities_list",
		"activities_get",
		"heart_rate_get",
		"hrv_get",
		"weight_get",
		"profile_get",
		"account_get",
	}
}

func (s *Server) newMCPServer() *sdkmcp.Server {
	server := sdkmcp.NewServer(&sdkmcp.Implementation{
		Name:    ServerName,
		Version: ServerVersion,
	}, nil)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "sleep_get",
		Description: "Get Google Health sleep sessions (Fitbit / Pixel Watch) via reconcile. " +
			"Omit dates for last night (wake-up day is today). " +
			"For several nights pass after_date (inclusive) and before_date (exclusive) once — do not call once per day. " +
			"Read sessions[]: duration_minutes, efficiency, stages_minutes, minutes_to_fall_asleep, minutes_awake. " +
			"The Google Health app Sleep Score (0-100) is not in the API; do not invent one. " +
			"efficiency is round(minutes asleep / minutes in the sleep period * 100).",
	}, s.sleepGet)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "activities_list",
		Description: "List recent Google Health exercises (dataTypes/exercise) in a date window. " +
			"Call this first for “what did I do?”, then activities_get for detail. " +
			"Pass after_date and before_date once for the whole window. " +
			"Exercise pages are 25; if next_page_token is set, call again with page_token. " +
			"Bound days in the human’s timezone.",
	}, s.activitiesList)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "activities_get",
		Description: "Get one exercise data point by id/name from activities_list. " +
			"Use after the human (or list tool) picks a log.",
	}, s.activitiesGet)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "heart_rate_get",
		Description: "Get daily resting heart rate from Google Health. " +
			"Omit date for today. For a span, pass after_date (inclusive) and before_date (exclusive) once and read entries[] — do not call once per day. " +
			"Use with sleep_get and hrv_get for recovery.",
	}, s.heartRateGet)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "hrv_get",
		Description: "Get daily heart-rate variability when the wearable recorded it. " +
			"Omit date for today. For a span, pass after_date (inclusive) and before_date (exclusive) once and read entries[] — do not call once per day.",
	}, s.hrvGet)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "weight_get",
		Description: "Get weight logs from Google Health for a period. " +
			"Use for scale trends — not for inventing weigh-ins.",
	}, s.weightGet)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "profile_get",
		Description: "Get Google Health identity / profile (display name, Fitbit + Google ids). " +
			"Useful to confirm which account is connected.",
	}, s.profileGet)

	sdkmcp.AddTool(server, &sdkmcp.Tool{
		Name: "account_get",
		Description: "Check Google Health auth / token status without running a data query when possible. " +
			"If unauthenticated, tell the human to run google-health-mcp auth or gantry auth ghealth.",
	}, s.accountGet)

	return server
}

// Run starts the MCP server over stdio. Missing auth does NOT fail boot.
func (s *Server) Run(ctx context.Context) error {
	if s.Client == nil {
		c := ghealth.MaybeFromEnv()
		if c.AccessToken == "" {
			s.Log.Printf("warning: Google Health tokens unset — data tools will error until google-health-mcp auth")
		}
		s.Client = c
	}
	return s.serve(ctx, &sdkmcp.StdioTransport{})
}

func (s *Server) serve(ctx context.Context, transport sdkmcp.Transport) error {
	server := s.newMCPServer()
	s.Log.Printf("starting stdio MCP (%s %s) tools=%s",
		ServerName, ServerVersion, strings.Join(RegisteredToolNames(), ","))
	return server.Run(ctx, transport)
}

// SelfTest validates tool registration and stub path — no OAuth.
func SelfTest() error {
	names := RegisteredToolNames()
	if len(names) == 0 {
		return errors.New("no tools registered")
	}
	for _, n := range names {
		if strings.HasPrefix(n, "ghealth_") || strings.HasPrefix(n, "health_") || strings.HasPrefix(n, "google_") {
			return fmt.Errorf("tool %q must not start with host/provider prefix", n)
		}
		if len(strings.Split(n, "_")) < 2 {
			return fmt.Errorf("tool %q must be service_verb…", n)
		}
	}
	stub := ghealth.NewStub()
	s := New(stub)
	_ = s.newMCPServer()
	ctx := context.Background()
	if _, err := stub.SleepGet(ctx, ghealth.SleepGetRequest{}); err != nil {
		return err
	}
	if _, err := stub.ActivitiesList(ctx, ghealth.ActivitiesListRequest{}); err != nil {
		return err
	}
	return nil
}
