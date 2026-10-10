package tools

import (
	"errors"
	"log/slog"
	"net/url"
	"regexp"
	"strings"
	"sync"
)

const (
	EnvChatMailboxURL    = "CHAT_MAILBOX_URL"
	EnvChatBearer        = "CHAT_BEARER" //nolint:gosec // G101: env var name, not a credential
	EnvChatAPIPrefix     = "CHAT_API_PREFIX"
	EnvPendantMailboxURL = "PENDANT_MAILBOX_URL" // deprecated alias of CHAT_MAILBOX_URL
	EnvPendantBearer     = "PENDANT_BEARER"      //nolint:gosec // G101: env var name, not a credential
	EnvImageOutputDir    = "IMAGE_OUTPUT_DIR"
	EnvPendantImageDir   = "PENDANT_IMAGE_DIR"

	defaultChatAPIPrefix = "/api/chat"
)

const (
	AvatarEdge       = 1280
	BackdropEdge     = 1600
	AvatarMaxBytes   = 5 * 1024 * 1024
	BackdropMaxBytes = 1_500_000
	JPEGEdgeMin      = 320
	JPEGEdgeStep     = 0.75
	HTTPTimeoutSec   = 15
)

var jpegQualities = []int{90, 80, 70, 60}

var slugRE = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)

// HostManifestBlurb is the yard Secrets one-liner.
const HostManifestBlurb = "Chat face / wallpaper / mood. Crane already has CHAT_MAILBOX_URL + CHAT_BEARER. IMAGE_OUTPUT_DIR is the photo_generate handoff; optional PENDANT_IMAGE_DIR is a second allowed root."

// OptionalEnvKeys lists Secrets fields that must not skip the server at boot.
func OptionalEnvKeys() []string {
	return []string{
		EnvChatMailboxURL,
		EnvChatBearer,
		EnvImageOutputDir,
		EnvPendantImageDir,
	}
}

type serverConfig struct {
	MailboxURL string
	APIPrefix  string
	Bearer     string
	Slug       string
	ImageRoots []string
}

// envWarner logs each deprecated PENDANT_* name at most once.
type envWarner struct {
	mu   sync.Mutex
	seen map[string]struct{}
	log  *slog.Logger
}

func (w *envWarner) warn(alias, canonical string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.seen == nil {
		w.seen = map[string]struct{}{}
	}
	if _, ok := w.seen[alias]; ok {
		return
	}
	w.seen[alias] = struct{}{}
	lg := w.log
	if lg == nil {
		lg = slog.Default()
	}
	lg.Warn("deprecated, use "+canonical, "env", alias)
}

// processEnvWarner is one warner for the life of the process.
var processEnvWarner envWarner

func loadConfigFromEnv(getenv func(string) string) (serverConfig, error) {
	return resolveServerConfig(getenv, &processEnvWarner)
}

func resolveServerConfig(getenv func(string) string, warn *envWarner) (serverConfig, error) {
	mailbox := lookupAlias(getenv, EnvChatMailboxURL, EnvPendantMailboxURL, warn)
	if mailbox == "" {
		return serverConfig{}, errNeedMailbox()
	}
	apiBase, slug, err := mailboxToAPI(mailbox)
	if err != nil {
		return serverConfig{}, err
	}
	bearer := lookupAlias(getenv, EnvChatBearer, EnvPendantBearer, warn)
	if bearer == "" {
		return serverConfig{}, errNeedBearer()
	}
	return serverConfig{
		MailboxURL: apiBase,
		APIPrefix:  normalizeAPIPrefix(getenv(EnvChatAPIPrefix)),
		Bearer:     bearer,
		Slug:       slug,
		ImageRoots: imageRoots(getenv),
	}, nil
}

func lookupAlias(getenv func(string) string, canonical, alias string, warn *envWarner) string {
	if v := strings.TrimSpace(getenv(canonical)); v != "" {
		return v
	}
	if v := strings.TrimSpace(getenv(alias)); v != "" {
		if warn != nil {
			warn.warn(alias, canonical)
		}
		return v
	}
	return ""
}

func normalizeAPIPrefix(raw string) string {
	p := strings.TrimSpace(raw)
	if p == "" {
		return defaultChatAPIPrefix
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return strings.TrimRight(p, "/")
}

func imageRoots(getenv func(string) string) []string {
	var roots []string
	for _, key := range []string{EnvImageOutputDir, EnvPendantImageDir} {
		if dir := strings.TrimSpace(getenv(key)); dir != "" {
			roots = append(roots, dir)
		}
	}
	return roots
}

// mailboxToAPI turns wss://host/ws/kit into https://host plus slug kit.
// Tests match gantry-pendant mailboxToAvatarUrl cases.
func mailboxToAPI(raw string) (base string, slug string, err error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return "", "", errBadMailbox()
	}
	switch u.Scheme {
	case "wss":
		u.Scheme = "https"
	case "ws":
		u.Scheme = "http"
	case "http", "https":
	default:
		return "", "", errBadMailbox()
	}
	parts := strings.FieldsFunc(u.Path, func(r rune) bool { return r == '/' })
	if len(parts) < 2 || parts[0] != "ws" {
		return "", "", errBadMailbox()
	}
	slug = strings.ToLower(strings.TrimSpace(parts[1]))
	if !slugRE.MatchString(slug) {
		return "", "", errBadMailbox()
	}
	u.Path = ""
	u.RawPath = ""
	u.RawQuery = ""
	u.Fragment = ""
	return strings.TrimRight(u.String(), "/"), slug, nil
}

func blobURL(cfg serverConfig, kind string) string {
	prefix := cfg.APIPrefix
	if prefix == "" {
		prefix = defaultChatAPIPrefix
	}
	raw := cfg.MailboxURL + prefix + "/" + kind
	u, err := url.Parse(raw)
	if err != nil {
		return raw + "?slug=" + url.QueryEscape(cfg.Slug)
	}
	q := u.Query()
	q.Set("slug", cfg.Slug)
	u.RawQuery = q.Encode()
	return u.String()
}

func errNeedMailbox() error {
	return errors.New(EnvChatMailboxURL + " is required (wss://…/ws/<slug>). " + nextThemeList)
}

func errNeedBearer() error {
	return errors.New(EnvChatBearer + " is required (Authorization: Bearer). " + nextThemeList)
}

func errBadMailbox() error {
	return errors.New(EnvChatMailboxURL + " must be ws(s) or http(s) with /ws/<slug>. " + nextThemeList)
}

func errNeedImageDir() error {
	return errors.New(EnvImageOutputDir + " is required for source_path (the image__photo_generate handoff). Set it on the crane, then " + nextAvatarUpdate)
}
