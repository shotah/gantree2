package tools

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
)

// themeCatalogTTL is how long theme_list cards stay in process memory.
// The Worker catalog is the source of truth; this only skips a second GET
// when theme_update follows theme_list on the same crane.
const themeCatalogTTL = 5 * time.Minute

type themeCatalog struct {
	ids map[string]bool
	at  time.Time
}

var (
	themeCatalogMu    sync.Mutex
	themeCatalogByKey = map[string]themeCatalog{}
)

func registerTheme(s *mcpserver.MCPServer) {
	list := mcp.NewTool(ToolThemeList,
		mcp.WithDescription("List the color moods you can put on the phone app. Each card has feel (happy, excited, sad, frustrated, angry, anxious, or neutral) and scheme (dark / light), a mood line, and two hexes. Filter by how you feel, then by light or dark. Pick one id, then call theme_update. Not for drawing a picture — that is image__photo_generate."),
	)
	registerTool(s, list, handleThemeList)

	update := mcp.NewTool(ToolThemeUpdate,
		mcp.WithDescription("Set the phone app's color mood. Pass a theme id from theme_list. Pick a card whose feel matches, scheme: light by day; neutral to go plain. Do not invent hex. Humans can unfollow and keep their own theme."),
		mcp.WithString("theme", mcp.Required(), mcp.Description("Catalog id from theme_list (not raw hex).")),
	)
	registerTool(s, update, handleThemeUpdate)

	del := mcp.NewTool(ToolThemeDelete,
		mcp.WithDescription("Clear the room mood on the phone app. Phones that follow you fall back to the theme they picked. Does not change the face or the wallpaper."),
	)
	registerTool(s, del, handleThemeDelete)
}

func handleThemeList(ctx context.Context, _ mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	cfg, err := loadConfigFromEnv(os.Getenv)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	got, err := pendantRequest(ctx, cfg, http.MethodGet, blobURL(cfg, "theme"), nil, "")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if got.Status >= 400 {
		return mcp.NewToolResultError(workerError(got.Body, got.Status)), nil
	}
	if ids, parseErr := parseThemeIDs(got.Body); parseErr == nil {
		rememberThemeCatalog(cfg, ids)
	}
	return mcp.NewToolResultText(strings.TrimSpace(string(got.Body))), nil
}

func handleThemeUpdate(ctx context.Context, request mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	theme := strings.ToLower(strings.TrimSpace(request.GetString("theme", "")))
	if theme == "" {
		return mcp.NewToolResultError("theme must be a catalog id. " + nextThemeList), nil
	}
	cfg, err := loadConfigFromEnv(os.Getenv)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	ids, err := fetchThemeIDs(ctx, cfg)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if !ids[theme] {
		return mcp.NewToolResultError("theme must be a catalog id. " + nextThemeList), nil
	}
	body, err := json.Marshal(map[string]string{"theme": theme})
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	got, err := pendantRequest(ctx, cfg, http.MethodPost, blobURL(cfg, "theme"), body, "application/json")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if got.Status >= 400 {
		forgetThemeCatalog(cfg)
		return mcp.NewToolResultError(workerError(got.Body, got.Status)), nil
	}
	return mcp.NewToolResultText(strings.TrimSpace(string(got.Body))), nil
}

func handleThemeDelete(ctx context.Context, _ mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	cfg, err := loadConfigFromEnv(os.Getenv)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	got, err := pendantRequest(ctx, cfg, http.MethodDelete, blobURL(cfg, "theme"), nil, "")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	if got.Status >= 400 {
		return mcp.NewToolResultError(workerError(got.Body, got.Status)), nil
	}
	return mcp.NewToolResultText(strings.TrimSpace(string(got.Body))), nil
}

func themeCatalogKey(cfg serverConfig) string {
	return cfg.MailboxURL + "\x00" + cfg.Slug
}

func resetThemeCatalogCache() {
	themeCatalogMu.Lock()
	defer themeCatalogMu.Unlock()
	clear(themeCatalogByKey)
}

func rememberThemeCatalog(cfg serverConfig, ids map[string]bool) {
	copied := make(map[string]bool, len(ids))
	for id, ok := range ids {
		if ok {
			copied[id] = true
		}
	}
	themeCatalogMu.Lock()
	defer themeCatalogMu.Unlock()
	themeCatalogByKey[themeCatalogKey(cfg)] = themeCatalog{ids: copied, at: time.Now()}
}

func forgetThemeCatalog(cfg serverConfig) {
	themeCatalogMu.Lock()
	defer themeCatalogMu.Unlock()
	delete(themeCatalogByKey, themeCatalogKey(cfg))
}

func cachedThemeIDs(cfg serverConfig) (map[string]bool, bool) {
	themeCatalogMu.Lock()
	defer themeCatalogMu.Unlock()
	got, ok := themeCatalogByKey[themeCatalogKey(cfg)]
	if !ok || len(got.ids) == 0 || time.Since(got.at) > themeCatalogTTL {
		return nil, false
	}
	return got.ids, true
}

func parseThemeIDs(raw []byte) (map[string]bool, error) {
	var wrap struct {
		Themes []struct {
			ID string `json:"id"`
		} `json:"themes"`
	}
	if err := json.Unmarshal(raw, &wrap); err != nil {
		return nil, errors.New("bad theme catalog")
	}
	ids := make(map[string]bool, len(wrap.Themes))
	for _, card := range wrap.Themes {
		id := strings.ToLower(strings.TrimSpace(card.ID))
		if id != "" {
			ids[id] = true
		}
	}
	if len(ids) == 0 {
		return nil, errors.New("theme catalog is empty. " + nextThemeList)
	}
	return ids, nil
}

func fetchThemeIDs(ctx context.Context, cfg serverConfig) (map[string]bool, error) {
	if ids, ok := cachedThemeIDs(cfg); ok {
		return ids, nil
	}
	got, err := pendantRequest(ctx, cfg, http.MethodGet, blobURL(cfg, "theme"), nil, "")
	if err != nil {
		return nil, err
	}
	if got.Status >= 400 {
		return nil, errors.New(workerError(got.Body, got.Status))
	}
	ids, err := parseThemeIDs(got.Body)
	if err != nil {
		return nil, err
	}
	rememberThemeCatalog(cfg, ids)
	return ids, nil
}
