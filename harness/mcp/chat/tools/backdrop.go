package tools

import (
	"context"
	"encoding/json"
	"net/http"
	"os"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
)

func registerBackdrop(s *mcpserver.MCPServer) {
	update := mcp.NewTool(ToolBackdropUpdate,
		mcp.WithDescription("Set the wallpaper behind the chat on the phone app. Pass source_path from image__photo_generate (ask for 9:16). Use backdrop_delete to go back to plain."),
		mcp.WithString("source_path", mcp.Description("File image__photo_generate wrote. Must sit inside IMAGE_OUTPUT_DIR (or PENDANT_IMAGE_DIR).")),
		mcp.WithString("source_image", mcp.Description("Optional base64 when the host keeps image bytes. Prefer source_path.")),
	)
	registerTool(s, update, handleBackdropUpdate)

	del := mcp.NewTool(ToolBackdropDelete,
		mcp.WithDescription("Clear the chat wallpaper on the phone app. The thread goes back to the plain theme canvas. Does not change the face or the mood."),
	)
	registerTool(s, del, handleBackdropDelete)
}

func handleBackdropUpdate(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return handleBlobUpdate(ctx, request, "backdrop", BackdropEdge, BackdropMaxBytes, nextBackdropUpdate)
}

func handleBackdropDelete(ctx context.Context, _ mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	cfg, err := loadConfigFromEnv(os.Getenv)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	got, err := pendantRequest(ctx, cfg, http.MethodDelete, blobURL(cfg, "backdrop"), nil, "")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if got.Status >= 400 {
		return mcp.NewToolResultError(workerError(got.Body, got.Status)), nil
	}
	rev, err := parseWriteJSON(got.Body)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	text, err := json.Marshal(blobWriteResult{Rev: rev, Bytes: 0, MIME: "image/jpeg"})
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return mcp.NewToolResultText(string(text)), nil
}

func handleBlobUpdate(ctx context.Context, request mcp.CallToolRequest, kind string, edge, maxBytes int, next string) (*mcp.CallToolResult, error) {
	cfg, err := loadConfigFromEnv(os.Getenv)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	raw, err := readSource(request.GetString("source_path", ""), request.GetString("source_image", ""), cfg.ImageRoots)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	jpeg, usedEdge, err := PrepareJPEG(raw, edge, maxBytes)
	if err != nil {
		return mcp.NewToolResultError(err.Error() + ". " + next), nil
	}
	got, err := pendantRequest(ctx, cfg, http.MethodPost, blobURL(cfg, kind), jpeg, "image/jpeg")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if got.Status >= 400 {
		return mcp.NewToolResultError(workerError(got.Body, got.Status)), nil
	}
	rev, err := parseWriteJSON(got.Body)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	text, err := json.Marshal(blobWriteResult{Rev: rev, Bytes: len(jpeg), Edge: usedEdge, MIME: "image/jpeg"})
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return mcp.NewToolResultText(string(text)), nil
}
