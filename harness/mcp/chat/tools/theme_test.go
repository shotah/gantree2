package tools

import (
	"regexp"
	"strings"
	"testing"
	"time"
)

// workerThemeIDs is the Pendant catalog: boom, paper, ink, then the mood
// dozen. Agent-facing MCP text must not name these — adding a card is a
// Worker change, not an MCP rebuild.
var workerThemeIDs = []string{
	"boom", "paper", "ink",
	"marquee", "lemonade",
	"neon", "fizz",
	"rain", "mist",
	"fuse", "grit",
	"siren", "flare",
	"static", "flicker",
}

func TestParseThemeIDsReadsWorkerCards(t *testing.T) {
	ids, err := parseThemeIDs([]byte(`{"theme":"boom","themes":[{"id":"Paper"},{"id":"siren"},{"id":" ink "}]}`))
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"paper", "siren", "ink"} {
		if !ids[id] {
			t.Fatalf("missing %s in %v", id, ids)
		}
	}
	if ids["boom"] {
		t.Fatal("current room theme is not a catalog card")
	}
}

func TestParseThemeIDsRefusesEmpty(t *testing.T) {
	if _, err := parseThemeIDs([]byte(`{"theme":null,"themes":[]}`)); err == nil {
		t.Fatal("want empty catalog error")
	}
	if _, err := parseThemeIDs([]byte(`{`)); err == nil {
		t.Fatal("want junk catalog error")
	}
}

func TestTeachInConstantsDoNotNameCatalogCards(t *testing.T) {
	t.Parallel()
	for _, blob := range []string{
		nextAvatarUpdate, nextAvatarGet,
		nextBackdropUpdate, nextBackdropDelete,
		nextThemeList, nextThemeDelete,
	} {
		assertNoCatalogIDs(t, blob)
	}
}

func TestThemeCatalogCacheIsPerRoom(t *testing.T) {
	resetThemeCatalogCache()
	kit := serverConfig{MailboxURL: "https://example.workers.dev", Slug: "kit"}
	ada := serverConfig{MailboxURL: "https://example.workers.dev", Slug: "ada"}
	rememberThemeCatalog(kit, map[string]bool{"siren": true})
	rememberThemeCatalog(ada, map[string]bool{"paper": true})
	kitIDs, ok := cachedThemeIDs(kit)
	if !ok || !kitIDs["siren"] || kitIDs["paper"] {
		t.Fatalf("kit cache = %v ok=%v", kitIDs, ok)
	}
	adaIDs, ok := cachedThemeIDs(ada)
	if !ok || !adaIDs["paper"] || adaIDs["siren"] {
		t.Fatalf("ada cache = %v ok=%v", adaIDs, ok)
	}
}

func TestThemeCatalogCacheExpires(t *testing.T) {
	resetThemeCatalogCache()
	cfg := serverConfig{MailboxURL: "https://example.workers.dev", Slug: "kit"}
	rememberThemeCatalog(cfg, map[string]bool{"siren": true})
	themeCatalogMu.Lock()
	got := themeCatalogByKey[themeCatalogKey(cfg)]
	got.at = time.Now().Add(-themeCatalogTTL - time.Second)
	themeCatalogByKey[themeCatalogKey(cfg)] = got
	themeCatalogMu.Unlock()
	if _, ok := cachedThemeIDs(cfg); ok {
		t.Fatal("want expired catalog")
	}
}

func TestForgetThemeCatalog(t *testing.T) {
	resetThemeCatalogCache()
	cfg := serverConfig{MailboxURL: "https://example.workers.dev", Slug: "kit"}
	rememberThemeCatalog(cfg, map[string]bool{"siren": true})
	forgetThemeCatalog(cfg)
	if _, ok := cachedThemeIDs(cfg); ok {
		t.Fatal("want forgotten catalog")
	}
}

func assertNoCatalogIDs(t *testing.T, blob string) {
	t.Helper()
	escaped := make([]string, len(workerThemeIDs))
	for i, id := range workerThemeIDs {
		escaped[i] = regexp.QuoteMeta(id)
	}
	re := regexp.MustCompile(`(?i)\b(?:` + strings.Join(escaped, "|") + `)\b`)
	if hit := re.FindString(blob); hit != "" {
		t.Errorf("agent-facing text names catalog id %q: %s", hit, blob)
	}
}
