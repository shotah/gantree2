package tools

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
)

const mimePNG = "image/png"

var errPromptRequired = errors.New(`prompt is required. ` + nextGenerate)

var allowedAspect = map[string]bool{
	"1:1": true, "2:3": true, "3:2": true, "3:4": true, "4:3": true,
	"9:16": true, "16:9": true, "21:9": true,
}

var allowedSize = map[string]bool{
	"1K": true, "2K": true, "4K": true,
}

// Summary is the short JSON hosts stringify for the model (no base64).
type Summary struct {
	Prompt string `json:"prompt"`
	Model  string `json:"model,omitempty"`
	MIME   string `json:"mime,omitempty"`
	Bytes  int    `json:"bytes"`
	Path   string `json:"path,omitempty"`
	Note   string `json:"note,omitempty"`
}

func registerGenerate(s *mcpserver.MCPServer) {
	tool := mcp.NewTool(ToolGenerate,
		mcp.WithDescription("Generate an image from a text prompt. Returns PNG bytes to MCP clients plus a short JSON summary (mime, bytes, model, optional path). Use for “draw”, “make an image”, “render a picture”. Prefer this over describing an image in prose. When IMAGE_OUTPUT_DIR is set, summary.path is the file for pendant__avatar_update (ask for 1:1) or pendant__backdrop_update (ask for 9:16); the chat also receives the picture. Not for Drive/Docs files — use google__drive_* or docs_insert_image. Not for editing an existing photo — use photo_edit."),
		mcp.WithString("prompt", mcp.Required(), mcp.Description("What to draw. Be specific about subject, style, and composition.")),
		mcp.WithString("aspect_ratio", mcp.Description("Optional. One of 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9.")),
		mcp.WithString("size", mcp.Description("Optional. 1K (default), 2K, or 4K.")),
	)
	registerTool(s, tool, handleGenerate)
}

func registerEdit(s *mcpserver.MCPServer) {
	tool := mcp.NewTool(ToolEdit,
		mcp.WithDescription("Edit an existing image with a text prompt. Pass source_path from photo_generate or pendant__avatar_get (must sit inside IMAGE_OUTPUT_DIR). Use for “make this watercolor”, “add a hat”. Not for creating from scratch — use photo_generate."),
		mcp.WithString("prompt", mcp.Required(), mcp.Description("How to change the image.")),
		mcp.WithString("source_path", mcp.Description("File on disk from photo_generate or pendant__avatar_get. Must resolve inside IMAGE_OUTPUT_DIR (or PENDANT_IMAGE_DIR). This is the v1 handoff.")),
		mcp.WithString("source_image", mcp.Description("Optional base64 when the host keeps image bytes. Prefer source_path.")),
		mcp.WithString("source_mime", mcp.Description("Optional MIME of the source (default from the file ext, else image/png).")),
		mcp.WithString("aspect_ratio", mcp.Description("Optional. One of 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9.")),
		mcp.WithString("size", mcp.Description("Optional. 1K (default), 2K, or 4K.")),
	)
	registerTool(s, tool, handleEdit)
}

func handleGenerate(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	req, err := parseGenerateArgs(request, false)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return runGenerate(ctx, req)
}

func handleEdit(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	req, err := parseGenerateArgs(request, true)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return runGenerate(ctx, req)
}

func parseGenerateArgs(request mcp.CallToolRequest, edit bool) (Request, error) {
	prompt, err := request.RequireString("prompt")
	if err != nil || strings.TrimSpace(prompt) == "" {
		if edit {
			return Request{}, errors.New(`prompt is required. ` + nextEdit)
		}
		return Request{}, errPromptRequired
	}
	req := Request{
		Prompt:      strings.TrimSpace(prompt),
		AspectRatio: strings.TrimSpace(request.GetString("aspect_ratio", "")),
		Size:        strings.TrimSpace(request.GetString("size", "")),
	}
	if err := validateAspectSize(req); err != nil {
		return Request{}, err
	}
	if edit {
		src, mime, err := readEditSource(
			request.GetString("source_path", ""),
			request.GetString("source_image", ""),
			request.GetString("source_mime", ""),
		)
		if err != nil {
			return Request{}, err
		}
		req.SourceData = src
		req.SourceMIME = mime
	}
	return req, nil
}

func validateAspectSize(req Request) error {
	if req.AspectRatio != "" && !allowedAspect[req.AspectRatio] {
		return errors.New(`aspect_ratio must be one of 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9. ` + nextGenerate)
	}
	if req.Size != "" && !allowedSize[req.Size] {
		return errors.New(`size must be 1K, 2K, or 4K. ` + nextGenerate)
	}
	return nil
}

func runGenerate(ctx context.Context, req Request) (*mcp.CallToolResult, error) {
	p, err := newProvider()
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	got, err := p.Generate(ctx, req)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	path, err := writeOutput(got)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	sum := Summary{
		Prompt: req.Prompt,
		Model:  got.Model,
		MIME:   got.MIME,
		Bytes:  len(got.Data),
		Path:   path,
		Note:   strings.TrimSpace(got.Note),
	}
	text, err := json.Marshal(sum)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return mcp.NewToolResultImage(string(text), base64.StdEncoding.EncodeToString(got.Data), got.MIME), nil
}
