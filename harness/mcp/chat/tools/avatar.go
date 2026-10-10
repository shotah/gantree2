package tools

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
)

func registerAvatar(s *mcpserver.MCPServer) {
	update := mcp.NewTool(ToolAvatarUpdate,
		mcp.WithDescription("Change your own profile picture / face on the phone app. Pass source_path from image__photo_generate (ask for a 1:1 portrait). Not a chat photo — do not use this to send a picture."),
		mcp.WithString("source_path", mcp.Description("File image__photo_generate wrote. Must sit inside IMAGE_OUTPUT_DIR (or PENDANT_IMAGE_DIR). This is the v1 handoff.")),
		mcp.WithString("source_image", mcp.Description("Optional base64 when the host keeps image bytes. Prefer source_path.")),
	)
	registerTool(s, update, handleAvatarUpdate)

	get := mcp.NewTool(ToolAvatarGet,
		mcp.WithDescription("Read your current phone-app face. Returns JPEG bytes to MCP clients plus { rev, bytes }. Writes a file when IMAGE_OUTPUT_DIR is set so photo_edit can start from it."),
	)
	registerTool(s, get, handleAvatarGet)
}

func handleAvatarUpdate(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return handleBlobUpdate(ctx, request, "avatar", AvatarEdge, AvatarMaxBytes, nextAvatarUpdate)
}

func handleAvatarGet(ctx context.Context, _ mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	cfg, err := loadConfigFromEnv(os.Getenv)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	got, err := pendantRequest(ctx, cfg, http.MethodGet, blobURL(cfg, "avatar"), nil, "")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if got.Status == http.StatusNotFound {
		return mcp.NewToolResultError("no face yet. " + nextAvatarUpdate), nil
	}
	if got.Status >= 400 {
		return mcp.NewToolResultError(workerError(got.Body, got.Status)), nil
	}
	rev, _ := strconv.ParseInt(strings.TrimSpace(got.Header.Get("X-Pendant-Rev")), 10, 64)
	path, err := writeOutput(got.Body, os.Getenv)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	sum := blobWriteResult{Rev: rev, Bytes: len(got.Body), Edge: AvatarEdge, MIME: "image/jpeg", Path: path}
	text, err := json.Marshal(sum)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return mcp.NewToolResultImage(string(text), base64.StdEncoding.EncodeToString(got.Body), "image/jpeg"), nil
}
