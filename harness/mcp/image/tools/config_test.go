package tools

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadConfigFromEnv(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		env     map[string]string
		want    serverConfig
		wantErr string
	}{
		{
			name: "image key wins over crane",
			env: map[string]string{
				EnvImageAPIKey: "image-key",
				EnvImageModel:  "gemini-3.1-flash-image",
				EnvLLMAPIKey:   "llm-key",
				EnvLLMModel:    "qwen-local",
			},
			want: serverConfig{
				Provider: ProviderGemini,
				Model:    "gemini-3.1-flash-image",
				APIKey:   "image-key",
			},
		},
		{
			name: "piggyback crane key",
			env: map[string]string{
				EnvLLMAPIKey: "llm-key",
			},
			want: serverConfig{
				Provider: ProviderGemini,
				Model:    DefaultModel,
				APIKey:   "llm-key",
			},
		},
		{
			name: "vertex",
			env: map[string]string{
				EnvGoogleGenAIUseVertexAI: "true",
				EnvGoogleCloudProject:     "proj-1",
			},
			want: serverConfig{
				Provider:  ProviderGemini,
				Model:     DefaultModel,
				UseVertex: true,
				Project:   "proj-1",
				Location:  DefaultLocation,
			},
		},
		{
			name:    "missing key",
			env:     map[string]string{},
			wantErr: errNeedAPIKey().Error(),
		},
		{
			name: "unknown provider",
			env: map[string]string{
				EnvImageAPIKey:   "k",
				EnvImageProvider: "openai",
			},
			wantErr: errUnknownProvider("openai").Error(),
		},
		{
			name: "vertex missing project",
			env: map[string]string{
				EnvGoogleGenAIUseVertexAI: "yes",
			},
			wantErr: errNeedVertexProject().Error(),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := loadConfigFromEnv(func(key string) string { return tt.env[key] })
			if tt.wantErr != "" {
				if err == nil || err.Error() != tt.wantErr {
					t.Fatalf("error = %v, want %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got.Provider != tt.want.Provider || got.Model != tt.want.Model || got.APIKey != tt.want.APIKey {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
			if got.UseVertex != tt.want.UseVertex || got.Project != tt.want.Project || got.Location != tt.want.Location {
				t.Fatalf("vertex got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestDefaultModelIsNanoBanana2(t *testing.T) {
	t.Parallel()
	if DefaultModel != "gemini-3.1-flash-image" {
		t.Fatalf("DefaultModel = %q", DefaultModel)
	}
}

func TestWriteOutputSkipsWhenUnset(t *testing.T) {
	t.Setenv(EnvImageOutputDir, "")
	path, err := writeOutput(Result{MIME: "image/png", Data: []byte("png")})
	if err != nil || path != "" {
		t.Fatalf("path=%q err=%v", path, err)
	}
}

func TestWriteOutputWritesFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv(EnvImageOutputDir, dir)
	path, err := writeOutput(Result{MIME: "image/png", Data: []byte("png-bytes")})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(path, dir) {
		t.Fatalf("path %q not under %s", path, dir)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "png-bytes" {
		t.Fatalf("file = %q", got)
	}
	if filepath.Ext(path) != ".png" {
		t.Fatalf("ext = %s", filepath.Ext(path))
	}
}

func TestWriteOutputJpegExt(t *testing.T) {
	dir := t.TempDir()
	t.Setenv(EnvImageOutputDir, dir)
	path, err := writeOutput(Result{MIME: "image/jpeg", Data: []byte("jpg")})
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Ext(path) != ".jpg" {
		t.Fatalf("ext = %s", filepath.Ext(path))
	}
}

func TestWriteOutputRejectsDotDot(t *testing.T) {
	t.Setenv(EnvImageOutputDir, "../nope")
	_, err := writeOutput(Result{MIME: mimePNG, Data: []byte("png")})
	if err == nil {
		t.Fatal("want error for ..")
	}
}

func TestIsEnabled(t *testing.T) {
	t.Parallel()
	for _, v := range []string{"1", "true", "YES", " on "} {
		if !isEnabled(v) {
			t.Fatalf("isEnabled(%q) = false", v)
		}
	}
	for _, v := range []string{"", "0", "false"} {
		if isEnabled(v) {
			t.Fatalf("isEnabled(%q) = true", v)
		}
	}
}

func TestFirstNonEmpty(t *testing.T) {
	t.Parallel()
	if got := firstNonEmpty("", "  ", "a", "b"); got != "a" {
		t.Fatalf("got %q", got)
	}
}

func TestOptionalEnvKeys(t *testing.T) {
	t.Parallel()
	keys := OptionalEnvKeys()
	if len(keys) < 4 {
		t.Fatalf("too few optional keys: %v", keys)
	}
}
