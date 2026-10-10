package tools

import (
	"bytes"
	"context"
	"encoding/base64"
	"strings"
	"testing"

	"google.golang.org/genai"
)

type stubGen struct {
	resp *genai.GenerateContentResponse
	err  error
}

func (s stubGen) GenerateContent(context.Context, string, []*genai.Content, *genai.GenerateContentConfig) (*genai.GenerateContentResponse, error) {
	return s.resp, s.err
}

func TestBuildContentsTextOnly(t *testing.T) {
	t.Parallel()
	got := buildContents(Request{Prompt: "a cat"})
	if len(got) != 1 || len(got[0].Parts) != 1 || got[0].Parts[0].Text != "a cat" {
		t.Fatalf("unexpected contents: %+v", got)
	}
}

func TestBuildContentsWithSource(t *testing.T) {
	t.Parallel()
	got := buildContents(Request{
		Prompt:     "watercolor",
		SourceMIME: "image/jpeg",
		SourceData: []byte{1, 2, 3},
	})
	if len(got) != 1 || len(got[0].Parts) != 2 {
		t.Fatalf("want image then text, got %+v", got)
	}
	if got[0].Parts[0].InlineData == nil || got[0].Parts[0].InlineData.MIMEType != "image/jpeg" {
		t.Fatalf("source part = %+v", got[0].Parts[0])
	}
	if got[0].Parts[1].Text != "watercolor" {
		t.Fatalf("prompt part = %+v", got[0].Parts[1])
	}
}

func TestBuildGenConfig(t *testing.T) {
	t.Parallel()
	empty := buildGenConfig(Request{})
	if empty.ImageConfig != nil {
		t.Fatal("empty request should omit ImageConfig")
	}
	got := buildGenConfig(Request{AspectRatio: "16:9", Size: "2K"})
	if got.ImageConfig == nil || got.ImageConfig.AspectRatio != "16:9" || got.ImageConfig.ImageSize != "2K" {
		t.Fatalf("ImageConfig = %+v", got.ImageConfig)
	}
	if len(got.ResponseModalities) != 2 {
		t.Fatalf("modalities = %v", got.ResponseModalities)
	}
}

func TestParseGeminiResponse(t *testing.T) {
	t.Parallel()
	png := []byte{0x89, 0x50, 0x4e, 0x47}
	resp := &genai.GenerateContentResponse{
		Candidates: []*genai.Candidate{{
			Content: &genai.Content{
				Parts: []*genai.Part{
					{Text: "here you go"},
					{InlineData: &genai.Blob{MIMEType: "image/png", Data: png}},
				},
			},
		}},
	}
	got, err := parseGeminiResponse("gemini-3.1-flash-image", resp)
	if err != nil {
		t.Fatal(err)
	}
	if got.Note != "here you go" || got.MIME != mimePNG || !bytes.Equal(got.Data, png) {
		t.Fatalf("got %+v", got)
	}
}

func TestParseGeminiResponseNoImage(t *testing.T) {
	t.Parallel()
	_, err := parseGeminiResponse("m", &genai.GenerateContentResponse{
		Candidates: []*genai.Candidate{{
			Content: &genai.Content{Parts: []*genai.Part{{Text: "blocked"}}},
		}},
	})
	if err == nil || !strings.Contains(err.Error(), "no image") {
		t.Fatalf("err = %v", err)
	}
}

func TestParseGeminiResponseNoCandidates(t *testing.T) {
	t.Parallel()
	_, err := parseGeminiResponse("m", &genai.GenerateContentResponse{})
	if err == nil || !strings.Contains(err.Error(), "no candidates") {
		t.Fatalf("err = %v", err)
	}
	_, err = parseGeminiResponse("m", nil)
	if err == nil {
		t.Fatal("nil resp should fail")
	}
}

func TestDecodeSourceImage(t *testing.T) {
	t.Parallel()
	raw := base64.StdEncoding.EncodeToString([]byte("hello"))
	got, err := decodeSourceImage(raw)
	if err != nil || string(got) != "hello" {
		t.Fatalf("got %q err=%v", got, err)
	}
	dataURL := "data:image/png;base64," + raw
	got, err = decodeSourceImage(dataURL)
	if err != nil || string(got) != "hello" {
		t.Fatalf("data url got %q err=%v", got, err)
	}
	if _, err := decodeSourceImage(""); err == nil {
		t.Fatal("empty should fail")
	}
	if _, err := decodeSourceImage("not-base64!!!"); err == nil {
		t.Fatal("junk should fail")
	}
}

func TestGeminiGenerateViaStub(t *testing.T) {
	t.Parallel()
	png := []byte{0x89, 0x50}
	p := &geminiProvider{
		model: "gemini-3.1-flash-image",
		generator: stubGen{resp: &genai.GenerateContentResponse{
			Candidates: []*genai.Candidate{{
				Content: &genai.Content{
					Parts: []*genai.Part{{InlineData: &genai.Blob{MIMEType: "image/png", Data: png}}},
				},
			}},
		}},
	}
	got, err := p.Generate(context.Background(), Request{Prompt: "cat"})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got.Data, png) {
		t.Fatalf("data = %v", got.Data)
	}
}

func TestGeminiGenerateNilProvider(t *testing.T) {
	t.Parallel()
	p := &geminiProvider{model: "x"}
	_, err := p.Generate(context.Background(), Request{Prompt: "cat"})
	if err == nil {
		t.Fatal("want not configured")
	}
}
