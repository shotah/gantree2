package tools

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"google.golang.org/genai"
)

type contentGenerator interface {
	GenerateContent(ctx context.Context, model string, contents []*genai.Content, config *genai.GenerateContentConfig) (*genai.GenerateContentResponse, error)
}

type geminiProvider struct {
	model     string
	generator contentGenerator
}

func newGeminiProvider(cfg serverConfig) (Provider, error) {
	ctx := context.Background()
	clientCfg := &genai.ClientConfig{}
	if cfg.UseVertex {
		clientCfg.Backend = genai.BackendVertexAI
		clientCfg.Project = cfg.Project
		clientCfg.Location = cfg.Location
	} else {
		clientCfg.Backend = genai.BackendGeminiAPI
		clientCfg.APIKey = cfg.APIKey
	}
	client, err := genai.NewClient(ctx, clientCfg)
	if err != nil {
		return nil, fmt.Errorf("create genai client: %w", err)
	}
	return &geminiProvider{model: cfg.Model, generator: client.Models}, nil
}

func (p *geminiProvider) Generate(ctx context.Context, req Request) (Result, error) {
	if p == nil || p.generator == nil {
		return Result{}, errors.New("image provider is not configured")
	}
	contents := buildContents(req)
	resp, err := p.generator.GenerateContent(ctx, p.model, contents, buildGenConfig(req))
	if err != nil {
		return Result{}, fmt.Errorf("image generate failed: %w", err)
	}
	return parseGeminiResponse(p.model, resp)
}

func buildContents(req Request) []*genai.Content {
	parts := []*genai.Part{{Text: req.Prompt}}
	if len(req.SourceData) > 0 {
		mime := req.SourceMIME
		if mime == "" {
			mime = mimePNG
		}
		parts = append([]*genai.Part{{
			InlineData: &genai.Blob{MIMEType: mime, Data: req.SourceData},
		}}, parts...)
	}
	return []*genai.Content{{Role: genai.RoleUser, Parts: parts}}
}

func buildGenConfig(req Request) *genai.GenerateContentConfig {
	cfg := &genai.GenerateContentConfig{
		ResponseModalities: []string{string(genai.ModalityText), string(genai.ModalityImage)},
	}
	img := &genai.ImageConfig{}
	if req.AspectRatio != "" {
		img.AspectRatio = req.AspectRatio
	}
	if req.Size != "" {
		img.ImageSize = req.Size
	}
	if img.AspectRatio != "" || img.ImageSize != "" {
		cfg.ImageConfig = img
	}
	return cfg
}

func parseGeminiResponse(model string, resp *genai.GenerateContentResponse) (Result, error) {
	if resp == nil || len(resp.Candidates) == 0 || resp.Candidates[0] == nil || resp.Candidates[0].Content == nil {
		return Result{}, errors.New("image generate returned no candidates")
	}
	out := Result{Model: model, MIME: mimePNG}
	for _, part := range resp.Candidates[0].Content.Parts {
		if part == nil {
			continue
		}
		if part.Text != "" {
			if out.Note != "" {
				out.Note += "\n"
			}
			out.Note += part.Text
		}
		if part.InlineData != nil && len(part.InlineData.Data) > 0 {
			out.Data = part.InlineData.Data
			if part.InlineData.MIMEType != "" {
				out.MIME = part.InlineData.MIMEType
			}
		}
	}
	if len(out.Data) == 0 {
		if out.Note != "" {
			return Result{}, fmt.Errorf("image generate returned no image: %s", strings.TrimSpace(out.Note))
		}
		return Result{}, errors.New("image generate returned no image")
	}
	return out, nil
}

func decodeSourceImage(raw string) ([]byte, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("source_image is required. " + nextEdit)
	}
	if i := strings.Index(raw, ","); i >= 0 && strings.Contains(strings.ToLower(raw[:i]), "base64") {
		raw = raw[i+1:]
	}
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		data, err = base64.RawStdEncoding.DecodeString(raw)
	}
	if err != nil {
		return nil, errors.New("source_image must be base64. " + nextEdit)
	}
	if len(data) == 0 {
		return nil, errors.New("source_image is empty. " + nextEdit)
	}
	return data, nil
}
