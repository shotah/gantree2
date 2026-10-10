package mcp

import (
	"context"
	"strings"

	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/shotah/google-health-mcp/internal/ghealth"
)

type sleepGetInput struct {
	Date       string `json:"date,omitempty" jsonschema:"One wake-up day YYYY-MM-DD. Omit for last night. Ignored when after_date or before_date is set."`
	AfterDate  string `json:"after_date,omitempty" jsonschema:"Inclusive wake-up day YYYY-MM-DD. Use with before_date to fetch many nights in one call."`
	BeforeDate string `json:"before_date,omitempty" jsonschema:"Exclusive wake-up day YYYY-MM-DD end bound."`
}

type activitiesListInput struct {
	AfterDate  string `json:"after_date,omitempty" jsonschema:"YYYY-MM-DD start (inclusive) in human timezone"`
	BeforeDate string `json:"before_date,omitempty" jsonschema:"YYYY-MM-DD end bound"`
	Limit      int    `json:"limit,omitempty" jsonschema:"Max activities (default 20)"`
	PageToken  string `json:"page_token,omitempty" jsonschema:"Pagination token from a prior list"`
}

type activitiesGetInput struct {
	ActivityID string `json:"activity_id" jsonschema:"Exercise data point id/name from activities_list"`
}

type heartRateGetInput struct {
	Date       string `json:"date,omitempty" jsonschema:"YYYY-MM-DD (default today). Ignored when after_date or before_date is set."`
	AfterDate  string `json:"after_date,omitempty" jsonschema:"Inclusive start YYYY-MM-DD. One call for the whole span."`
	BeforeDate string `json:"before_date,omitempty" jsonschema:"Exclusive end YYYY-MM-DD."`
}

type hrvGetInput struct {
	Date       string `json:"date,omitempty" jsonschema:"YYYY-MM-DD (default today). Ignored when after_date or before_date is set."`
	AfterDate  string `json:"after_date,omitempty" jsonschema:"Inclusive start YYYY-MM-DD. One call for the whole span."`
	BeforeDate string `json:"before_date,omitempty" jsonschema:"Exclusive end YYYY-MM-DD."`
}

type weightGetInput struct {
	BaseDate string `json:"base_date,omitempty" jsonschema:"YYYY-MM-DD end of window"`
	Period   string `json:"period,omitempty" jsonschema:"e.g. 1m or 3m"`
}

type profileGetInput struct{}

type accountGetInput struct{}

func (s *Server) sleepGet(ctx context.Context, _ *sdkmcp.CallToolRequest, in sleepGetInput) (*sdkmcp.CallToolResult, any, error) {
	if s.Client == nil {
		return errResult("client not configured"), nil, nil
	}
	res, err := s.Client.SleepGet(ctx, ghealth.SleepGetRequest{
		Date:       in.Date,
		AfterDate:  in.AfterDate,
		BeforeDate: in.BeforeDate,
	})
	if err != nil {
		return errResult(err.Error()), nil, nil
	}
	return jsonResult(res)
}

func (s *Server) activitiesList(ctx context.Context, _ *sdkmcp.CallToolRequest, in activitiesListInput) (*sdkmcp.CallToolResult, any, error) {
	if s.Client == nil {
		return errResult("client not configured"), nil, nil
	}
	res, err := s.Client.ActivitiesList(ctx, ghealth.ActivitiesListRequest{
		AfterDate:  in.AfterDate,
		BeforeDate: in.BeforeDate,
		Limit:      in.Limit,
		PageToken:  in.PageToken,
	})
	if err != nil {
		return errResult(err.Error()), nil, nil
	}
	return jsonResult(res)
}

func (s *Server) activitiesGet(ctx context.Context, _ *sdkmcp.CallToolRequest, in activitiesGetInput) (*sdkmcp.CallToolResult, any, error) {
	if strings.TrimSpace(in.ActivityID) == "" {
		return errResult("activity_id is required"), nil, nil
	}
	if s.Client == nil {
		return errResult("client not configured"), nil, nil
	}
	res, err := s.Client.ActivitiesGet(ctx, in.ActivityID)
	if err != nil {
		return errResult(err.Error()), nil, nil
	}
	return jsonResult(res)
}

func (s *Server) heartRateGet(ctx context.Context, _ *sdkmcp.CallToolRequest, in heartRateGetInput) (*sdkmcp.CallToolResult, any, error) {
	if s.Client == nil {
		return errResult("client not configured"), nil, nil
	}
	res, err := s.Client.HeartRateGet(ctx, ghealth.HeartRateRequest{
		Date:       in.Date,
		AfterDate:  in.AfterDate,
		BeforeDate: in.BeforeDate,
	})
	if err != nil {
		return errResult(err.Error()), nil, nil
	}
	return jsonResult(res)
}

func (s *Server) hrvGet(ctx context.Context, _ *sdkmcp.CallToolRequest, in hrvGetInput) (*sdkmcp.CallToolResult, any, error) {
	if s.Client == nil {
		return errResult("client not configured"), nil, nil
	}
	res, err := s.Client.HRVGet(ctx, ghealth.HRVRequest{
		Date:       in.Date,
		AfterDate:  in.AfterDate,
		BeforeDate: in.BeforeDate,
	})
	if err != nil {
		return errResult(err.Error()), nil, nil
	}
	return jsonResult(res)
}

func (s *Server) weightGet(ctx context.Context, _ *sdkmcp.CallToolRequest, in weightGetInput) (*sdkmcp.CallToolResult, any, error) {
	if s.Client == nil {
		return errResult("client not configured"), nil, nil
	}
	res, err := s.Client.WeightGet(ctx, ghealth.WeightRequest{BaseDate: in.BaseDate, Period: in.Period})
	if err != nil {
		return errResult(err.Error()), nil, nil
	}
	return jsonResult(res)
}

func (s *Server) profileGet(ctx context.Context, _ *sdkmcp.CallToolRequest, _ profileGetInput) (*sdkmcp.CallToolResult, any, error) {
	if s.Client == nil {
		return errResult("client not configured"), nil, nil
	}
	res, err := s.Client.ProfileGet(ctx)
	if err != nil {
		return errResult(err.Error()), nil, nil
	}
	return jsonResult(res)
}

func (s *Server) accountGet(_ context.Context, _ *sdkmcp.CallToolRequest, _ accountGetInput) (*sdkmcp.CallToolResult, any, error) {
	if s.Client == nil {
		return jsonResult(map[string]any{
			"provider":      "Google Health API",
			"authenticated": false,
			"note":          "client not configured",
			"host_id":       "ghealth",
		})
	}
	return jsonResult(s.Client.AccountStatus())
}

func errResult(msg string) *sdkmcp.CallToolResult {
	return &sdkmcp.CallToolResult{
		Content: []sdkmcp.Content{&sdkmcp.TextContent{Text: msg}},
		IsError: true,
	}
}

func jsonResult(v any) (*sdkmcp.CallToolResult, any, error) {
	return &sdkmcp.CallToolResult{}, v, nil
}
