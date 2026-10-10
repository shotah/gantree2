package tools

import (
	"errors"
	"strings"
)

// Environment this binary reads. host-manifest, loadConfigFromEnv, and error
// text must stay aligned with these names.
const (
	// EnvImageAPIKey wins so a local crane mouth can still pin Gemini for images.
	EnvImageAPIKey     = "IMAGE_API_KEY" //nolint:gosec // G101: env var name, not a credential
	EnvImageModel      = "IMAGE_MODEL"
	EnvImageProvider   = "IMAGE_PROVIDER"
	EnvImageOutputDir  = "IMAGE_OUTPUT_DIR"
	EnvPendantImageDir = "PENDANT_IMAGE_DIR"

	// EnvLLMAPIKey / EnvLLMModel are the crane mouth. Used when image-specific
	// vars are blank. Already crane fields — not re-asked as required.
	EnvLLMAPIKey = "LLM_API_KEY" //nolint:gosec // G101: env var name, not a credential
	EnvLLMModel  = "LLM_MODEL"

	EnvGoogleCloudProject     = "GOOGLE_CLOUD_PROJECT"
	EnvGoogleCloudLocation    = "GOOGLE_CLOUD_LOCATION"
	EnvGoogleGenAIUseVertexAI = "GOOGLE_GENAI_USE_VERTEXAI"
)

const (
	// ProviderGemini is Nano Banana (Gemini native image models).
	ProviderGemini = "gemini"

	// DefaultProvider is used when IMAGE_PROVIDER is unset.
	DefaultProvider = ProviderGemini

	// DefaultModel is Nano Banana 2 (Gemini 3.1 Flash Image).
	DefaultModel = "gemini-3.1-flash-image"

	// DefaultLocation is used when Vertex location is unset.
	DefaultLocation = "global"
)

// HostManifestBlurb is the yard Secrets one-liner.
const HostManifestBlurb = "Image gen (Nano Banana default). IMAGE_API_KEY wins; else crane LLM_API_KEY. Optional IMAGE_MODEL / IMAGE_PROVIDER / IMAGE_OUTPUT_DIR. Vertex: GOOGLE_GENAI_USE_VERTEXAI + GOOGLE_CLOUD_PROJECT."

// OptionalEnvKeys lists Secrets fields that must not skip the server at boot.
func OptionalEnvKeys() []string {
	return []string{
		EnvImageAPIKey,
		EnvImageModel,
		EnvImageProvider,
		EnvImageOutputDir,
		EnvGoogleGenAIUseVertexAI,
		EnvGoogleCloudProject,
		EnvGoogleCloudLocation,
	}
}

type serverConfig struct {
	Provider  string
	Model     string
	OutputDir string
	APIKey    string
	UseVertex bool
	Project   string
	Location  string
}

func loadConfigFromEnv(getenv func(string) string) (serverConfig, error) {
	cfg := serverConfig{
		Provider:  resolveProvider(getenv),
		Model:     resolveModel(getenv),
		OutputDir: strings.TrimSpace(getenv(EnvImageOutputDir)),
	}

	if cfg.Provider != ProviderGemini {
		return serverConfig{}, errUnknownProvider(cfg.Provider)
	}

	cfg.UseVertex = isEnabled(getenv(EnvGoogleGenAIUseVertexAI))
	if cfg.UseVertex {
		cfg.Project = strings.TrimSpace(getenv(EnvGoogleCloudProject))
		if cfg.Project == "" {
			return serverConfig{}, errNeedVertexProject()
		}
		cfg.Location = strings.TrimSpace(getenv(EnvGoogleCloudLocation))
		if cfg.Location == "" {
			cfg.Location = DefaultLocation
		}
		return cfg, nil
	}

	cfg.APIKey = firstNonEmpty(getenv(EnvImageAPIKey), getenv(EnvLLMAPIKey))
	if cfg.APIKey == "" {
		return serverConfig{}, errNeedAPIKey()
	}
	return cfg, nil
}

func resolveProvider(getenv func(string) string) string {
	p := strings.ToLower(strings.TrimSpace(getenv(EnvImageProvider)))
	if p == "" {
		return DefaultProvider
	}
	return p
}

func resolveModel(getenv func(string) string) string {
	if model := strings.TrimSpace(getenv(EnvImageModel)); model != "" {
		return model
	}
	if model := strings.TrimSpace(getenv(EnvLLMModel)); model != "" {
		return model
	}
	return DefaultModel
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func isEnabled(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func errNeedAPIKey() error {
	return errors.New(EnvImageAPIKey + " (or " + EnvLLMAPIKey + ") is required when using Google AI Studio. " + nextGenerate)
}

func errNeedVertexProject() error {
	return errors.New(EnvGoogleCloudProject + " is required when " + EnvGoogleGenAIUseVertexAI + " is set")
}

func errUnknownProvider(p string) error {
	return errors.New(EnvImageProvider + " " + p + " is not implemented. Supported: gemini (Nano Banana). Next: set " + EnvImageProvider + "=" + ProviderGemini)
}
