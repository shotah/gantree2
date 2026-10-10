package tools

import (
	"bytes"
	"log/slog"
	"os"
	"strings"
	"testing"
)

func TestMain(m *testing.M) {
	os.Unsetenv(EnvChatMailboxURL)
	os.Unsetenv(EnvChatBearer)
	os.Unsetenv(EnvChatAPIPrefix)
	os.Unsetenv(EnvPendantMailboxURL)
	os.Unsetenv(EnvPendantBearer)
	os.Exit(m.Run())
}

func TestMailboxToAPI(t *testing.T) {
	t.Parallel()
	base, slug, err := mailboxToAPI("wss://gantry-pendant.example.workers.dev/ws/kit")
	if err != nil {
		t.Fatal(err)
	}
	if base != "https://gantry-pendant.example.workers.dev" || slug != "kit" {
		t.Fatalf("base=%q slug=%q", base, slug)
	}
	base, slug, err = mailboxToAPI("ws://127.0.0.1:3000/ws/kit")
	if err != nil || base != "http://127.0.0.1:3000" || slug != "kit" {
		t.Fatalf("local base=%q slug=%q err=%v", base, slug, err)
	}
	if _, _, err := mailboxToAPI("not a url"); err == nil {
		t.Fatal("junk should fail")
	}
	if _, _, err := mailboxToAPI("wss://x.example/ws/1bad"); err == nil {
		t.Fatal("bad slug should fail")
	}
	if _, _, err := mailboxToAPI("ftp://x.example/ws/kit"); err == nil {
		t.Fatal("ftp should fail")
	}
	if _, _, err := mailboxToAPI("https://x.example/nope"); err == nil {
		t.Fatal("missing /ws/<slug> should fail")
	}
}

func TestLoadConfigFromEnv(t *testing.T) {
	t.Parallel()
	cfg, err := loadConfigFromEnv(func(key string) string {
		switch key {
		case EnvChatMailboxURL:
			return "wss://example.workers.dev/ws/kit"
		case EnvChatBearer:
			return "secret"
		case EnvImageOutputDir:
			return "/tmp/out"
		case EnvPendantMailboxURL:
			return "wss://old.example/ws/nope"
		case EnvPendantBearer:
			return "old-secret"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Slug != "kit" || cfg.Bearer != "secret" || cfg.MailboxURL != "https://example.workers.dev" {
		t.Fatalf("%+v", cfg)
	}
	if cfg.APIPrefix != defaultChatAPIPrefix {
		t.Fatalf("prefix = %q", cfg.APIPrefix)
	}
	if len(cfg.ImageRoots) != 1 || cfg.ImageRoots[0] != "/tmp/out" {
		t.Fatalf("roots = %v", cfg.ImageRoots)
	}
	if blobURL(cfg, "avatar") != "https://example.workers.dev/api/chat/avatar?slug=kit" {
		t.Fatalf("avatar url = %s", blobURL(cfg, "avatar"))
	}
	bare := cfg
	bare.APIPrefix = ""
	if blobURL(bare, "theme") != "https://example.workers.dev/api/chat/theme?slug=kit" {
		t.Fatalf("default prefix url = %s", blobURL(bare, "theme"))
	}
}

func TestLoadConfigMissing(t *testing.T) {
	t.Parallel()
	if _, err := loadConfigFromEnv(func(string) string { return "" }); err == nil {
		t.Fatal("want mailbox error")
	}
	if _, err := loadConfigFromEnv(func(key string) string {
		if key == EnvChatMailboxURL {
			return "wss://x.example/ws/kit"
		}
		return ""
	}); err == nil {
		t.Fatal("want bearer error")
	}
}

func TestLoadConfigAliasesAndAPIPrefix(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	warn := &envWarner{log: slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelWarn}))}
	getenv := func(key string) string {
		switch key {
		case EnvPendantMailboxURL:
			return "wss://example.workers.dev/ws/kit"
		case EnvPendantBearer:
			return "secret"
		case EnvChatAPIPrefix:
			return "/api/"
		default:
			return ""
		}
	}
	cfg, err := resolveServerConfig(getenv, warn)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Bearer != "secret" || cfg.Slug != "kit" {
		t.Fatalf("%+v", cfg)
	}
	if blobURL(cfg, "avatar") != "https://example.workers.dev/api/avatar?slug=kit" {
		t.Fatalf("escape hatch url = %s", blobURL(cfg, "avatar"))
	}
	for _, name := range []string{"deprecated, use CHAT_MAILBOX_URL", "env=PENDANT_MAILBOX_URL", "deprecated, use CHAT_BEARER", "env=PENDANT_BEARER"} {
		if !strings.Contains(buf.String(), name) {
			t.Fatalf("log missing %s: %s", name, buf.String())
		}
	}
	if strings.Count(buf.String(), "deprecated, use ") != 2 {
		t.Fatalf("warn count: %s", buf.String())
	}
	buf.Reset()
	if _, err = resolveServerConfig(getenv, warn); err != nil {
		t.Fatal(err)
	}
	if buf.Len() != 0 {
		t.Fatalf("second resolve warned again: %s", buf.String())
	}

	buf.Reset()
	both := func(key string) string {
		switch key {
		case EnvChatMailboxURL:
			return "wss://chat.example/ws/kit"
		case EnvChatBearer:
			return "chat-secret"
		case EnvPendantMailboxURL:
			return "wss://old.example/ws/nope"
		case EnvPendantBearer:
			return "old"
		case EnvChatAPIPrefix:
			return "api/chat/"
		default:
			return ""
		}
	}
	cfg, err = resolveServerConfig(both, warn)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.MailboxURL != "https://chat.example" || cfg.Bearer != "chat-secret" || cfg.APIPrefix != "/api/chat" {
		t.Fatalf("%+v", cfg)
	}
	if buf.Len() != 0 {
		t.Fatalf("CHAT_* must not warn: %s", buf.String())
	}
	if got := lookupAlias(func(key string) string {
		if key == EnvPendantMailboxURL {
			return "wss://alias.example/ws/kit"
		}
		return ""
	}, EnvChatMailboxURL, EnvPendantMailboxURL, nil); got != "wss://alias.example/ws/kit" {
		t.Fatalf("nil warner lookup = %q", got)
	}
}

func TestOptionalEnvKeys(t *testing.T) {
	t.Parallel()
	keys := OptionalEnvKeys()
	if len(keys) != 4 {
		t.Fatalf("keys = %v", keys)
	}
}
