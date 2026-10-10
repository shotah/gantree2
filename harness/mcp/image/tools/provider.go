package tools

import (
	"context"
	"os"
)

// Request is one generate or edit call. Provider-agnostic so Gemini can be swapped.
type Request struct {
	Prompt      string
	AspectRatio string
	Size        string
	SourceMIME  string
	SourceData  []byte
}

// Result is the generated (or edited) image.
type Result struct {
	MIME  string
	Data  []byte
	Model string
	Note  string
}

// Provider is one image backend. Swap Gemini / others here without renaming tools.
type Provider interface {
	Generate(ctx context.Context, req Request) (Result, error)
}

// newProvider builds the configured backend. Tests replace this.
var newProvider = providerFromEnv

func providerFromEnv() (Provider, error) {
	cfg, err := loadConfigFromEnv(os.Getenv)
	if err != nil {
		return nil, err
	}
	return newGeminiProvider(cfg)
}
