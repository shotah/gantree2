package config

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

func TestRoomOwnedAdmission(t *testing.T) {
	clearRoomAdmissionLog()
	t.Cleanup(clearRoomAdmissionLog)

	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	t.Setenv("LLM_BASE_URL", "https://example.com/v1")
	t.Setenv("LLM_API_KEY", "test-key")
	t.Setenv("LLM_MODEL", "test-model")
	t.Setenv("CHANNEL", "chat")
	t.Setenv("CHAT_MAILBOX_URL", "wss://chat.example/ws/kit")
	t.Setenv("CHAT_BEARER", "chat-tok")
	t.Setenv("CHAT_ALLOWED_USERS", "")
	t.Setenv("PENDANT_ALLOWED_USERS", "")
	t.Setenv("SNAPSHOT", "false")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "CHAT_ALLOWED_USERS") {
		t.Fatalf("compose stack: %v", err)
	}
	if strings.Contains(buf.String(), "admission is room-owned") {
		t.Fatalf("logged outside SNAPSHOT: %s", buf.String())
	}

	t.Setenv("SNAPSHOT", "true")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Channel != ChannelChat || !cfg.Snapshot || len(cfg.PendantAllowedUsers) != 0 {
		t.Fatalf("%+v", cfg)
	}
	if strings.Count(buf.String(), "admission is room-owned") != 1 {
		t.Fatalf("boot log: %s", buf.String())
	}

	buf.Reset()
	t.Setenv("CHANNEL", "pendant")
	if _, err = Load(); err != nil {
		t.Fatal(err)
	}
	if buf.Len() != 0 {
		t.Fatalf("second boot logged again: %s", buf.String())
	}
}

func TestChatEnvAliases(t *testing.T) {
	clearDeprecatedEnvWarns()
	t.Cleanup(clearDeprecatedEnvWarns)

	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelWarn})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	t.Setenv("LLM_BASE_URL", "https://example.com/v1")
	t.Setenv("LLM_API_KEY", "test-key")
	t.Setenv("LLM_MODEL", "test-model")
	t.Setenv("CHANNEL", "chat")
	t.Setenv("CHAT_MAILBOX_URL", "wss://chat.example/ws/kit")
	t.Setenv("CHAT_BEARER", "chat-tok")
	t.Setenv("CHAT_ALLOWED_USERS", "1182:ada@example.com, 1183")
	t.Setenv("CHAT_MAILBOX_URL", "wss://old.example/ws/nope")
	t.Setenv("PENDANT_BEARER", "old-tok")
	t.Setenv("PENDANT_ALLOWED_USERS", "999")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Channel != ChannelChat {
		t.Fatalf("Channel = %q", cfg.Channel)
	}
	if cfg.PendantMailboxURL != "wss://chat.example/ws/kit" || cfg.PendantBearer != "chat-tok" {
		t.Fatalf("CHAT_* lost to PENDANT_*: %+v", cfg)
	}
	if cfg.PendantAllowedUsers[0] != "1182:ada@example.com" || cfg.PendantAllowedUsers[1] != "1183" {
		t.Fatalf("users = %#v", cfg.PendantAllowedUsers)
	}
	if strings.Contains(buf.String(), "deprecated") {
		t.Fatalf("canonical CHAT_* must not warn: %s", buf.String())
	}

	if envListSupplied(nil) || envListSupplied([]string{" ", ""}) || !envListSupplied([]string{"", "1"}) {
		t.Fatal("envListSupplied")
	}
	if !IsChatChannel(ChannelChat) || !IsChatChannel(ChannelPendant) || IsChatChannel(ChannelTelegram) {
		t.Fatal("IsChatChannel")
	}

	// Mailbox stays on CHAT_*; bearer and allowlist fall back.
	t.Setenv("CHAT_BEARER", "")
	t.Setenv("CHAT_ALLOWED_USERS", "")
	buf.Reset()
	cfg, err = Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PendantMailboxURL != "wss://chat.example/ws/kit" || cfg.PendantBearer != "old-tok" {
		t.Fatalf("partial alias: %+v", cfg)
	}
	if len(cfg.PendantAllowedUsers) != 1 || cfg.PendantAllowedUsers[0] != "999" {
		t.Fatalf("users = %#v", cfg.PendantAllowedUsers)
	}
	if strings.Contains(buf.String(), "CHAT_MAILBOX_URL") {
		t.Fatalf("mailbox came from CHAT_*: %s", buf.String())
	}
	for _, name := range []string{"CHAT_BEARER", "CHAT_ALLOWED_USERS", "PENDANT_BEARER", "PENDANT_ALLOWED_USERS"} {
		if !strings.Contains(buf.String(), name) {
			t.Fatalf("log missing %s: %s", name, buf.String())
		}
	}
	if strings.Count(buf.String(), "deprecated, use ") != 2 {
		t.Fatalf("warn count: %s", buf.String())
	}

	t.Setenv("CHAT_MAILBOX_URL", "   ")
	t.Setenv("CHANNEL", " PENDANT ")
	buf.Reset()
	cfg, err = Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Channel != ChannelPendant || cfg.PendantMailboxURL != "wss://old.example/ws/nope" {
		t.Fatalf("full alias: %+v", cfg)
	}
	if !strings.Contains(buf.String(), "deprecated, use CHAT_MAILBOX_URL") || !strings.Contains(buf.String(), "env=CHAT_MAILBOX_URL") {
		t.Fatalf("mailbox warn: %s", buf.String())
	}
	if strings.Contains(buf.String(), "CHAT_BEARER") || strings.Contains(buf.String(), "CHAT_ALLOWED_USERS") {
		t.Fatalf("already-warned names repeated: %s", buf.String())
	}

	buf.Reset()
	if _, err = Load(); err != nil {
		t.Fatal(err)
	}
	if buf.Len() != 0 {
		t.Fatalf("second load warned again: %s", buf.String())
	}

	t.Setenv("CHAT_MAILBOX_URL", "")
	t.Setenv("PENDANT_BEARER", "")
	t.Setenv("PENDANT_ALLOWED_USERS", "")
	t.Setenv("CHAT_MAILBOX_URL", "")
	_, err = Load()
	if err == nil || !strings.Contains(err.Error(), "CHAT_MAILBOX_URL") || !strings.Contains(err.Error(), "CHANNEL=pendant") {
		t.Fatalf("%v", err)
	}
}
