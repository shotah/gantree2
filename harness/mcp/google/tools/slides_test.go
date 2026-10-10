package tools

import (
	"strings"
	"testing"

	slides "google.golang.org/api/slides/v1"
)

// --- mapToStruct tests ---

func TestSlidesMapToStruct(t *testing.T) {
	type simpleStruct struct {
		Name  string `json:"name"`
		Value int    `json:"value"`
	}

	tests := []struct {
		name    string
		input   map[string]any
		wantErr bool
		check   func(t *testing.T, out simpleStruct)
	}{
		{
			name:  "basic fields",
			input: map[string]any{"name": "test", "value": 42},
			check: func(t *testing.T, out simpleStruct) {
				if out.Name != "test" {
					t.Errorf("Name = %q, want %q", out.Name, "test")
				}
				if out.Value != 42 {
					t.Errorf("Value = %d, want %d", out.Value, 42)
				}
			},
		},
		{
			name:  "empty map",
			input: map[string]any{},
			check: func(t *testing.T, out simpleStruct) {
				if out.Name != "" {
					t.Errorf("Name = %q, want empty", out.Name)
				}
				if out.Value != 0 {
					t.Errorf("Value = %d, want 0", out.Value)
				}
			},
		},
		{
			name:  "extra fields ignored",
			input: map[string]any{"name": "hello", "value": 7, "extra": "ignored"},
			check: func(t *testing.T, out simpleStruct) {
				if out.Name != "hello" {
					t.Errorf("Name = %q, want %q", out.Name, "hello")
				}
				if out.Value != 7 {
					t.Errorf("Value = %d, want %d", out.Value, 7)
				}
			},
		},
		{
			name:  "nil map",
			input: nil,
			check: func(t *testing.T, out simpleStruct) {
				// nil marshals to "null" which unmarshals to zero value
				if out.Name != "" {
					t.Errorf("Name = %q, want empty", out.Name)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var out simpleStruct
			err := mapToStruct(tt.input, &out)
			if (err != nil) != tt.wantErr {
				t.Fatalf("mapToStruct() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && tt.check != nil {
				tt.check(t, out)
			}
		})
	}
}

// --- extractSlideText tests ---

func TestSlidesExtractSlideText(t *testing.T) {
	tests := []struct {
		name         string
		slide        *slides.Page
		wantEmpty    bool
		wantContains []string
	}{
		{
			name:      "nil page elements",
			slide:     &slides.Page{},
			wantEmpty: true,
		},
		{
			name: "empty page elements",
			slide: &slides.Page{
				PageElements: []*slides.PageElement{},
			},
			wantEmpty: true,
		},
		{
			name: "element without shape",
			slide: &slides.Page{
				PageElements: []*slides.PageElement{
					{ObjectId: "elem1"},
				},
			},
			wantEmpty: true,
		},
		{
			name: "shape without text",
			slide: &slides.Page{
				PageElements: []*slides.PageElement{
					{
						ObjectId: "elem1",
						Shape:    &slides.Shape{},
					},
				},
			},
			wantEmpty: true,
		},
		{
			name: "shape with nil text elements",
			slide: &slides.Page{
				PageElements: []*slides.PageElement{
					{
						ObjectId: "elem1",
						Shape: &slides.Shape{
							Text: &slides.TextContent{},
						},
					},
				},
			},
			wantEmpty: true,
		},
		{
			name: "shape with text run without content",
			slide: &slides.Page{
				PageElements: []*slides.PageElement{
					{
						ObjectId: "elem1",
						Shape: &slides.Shape{
							Text: &slides.TextContent{
								TextElements: []*slides.TextElement{
									{TextRun: &slides.TextRun{Content: ""}},
								},
							},
						},
					},
				},
			},
			wantEmpty: true,
		},
		{
			name: "single text run",
			slide: &slides.Page{
				PageElements: []*slides.PageElement{
					{
						ObjectId: "elem1",
						Shape: &slides.Shape{
							Text: &slides.TextContent{
								TextElements: []*slides.TextElement{
									{
										StartIndex: 0,
										TextRun:    &slides.TextRun{Content: "Hello World"},
									},
								},
							},
						},
					},
				},
			},
			wantContains: []string{"Hello World"},
		},
		{
			name: "multiple text runs sorted by start index",
			slide: &slides.Page{
				PageElements: []*slides.PageElement{
					{
						ObjectId: "elem1",
						Shape: &slides.Shape{
							Text: &slides.TextContent{
								TextElements: []*slides.TextElement{
									{
										StartIndex: 6,
										TextRun:    &slides.TextRun{Content: "World"},
									},
									{
										StartIndex: 0,
										TextRun:    &slides.TextRun{Content: "Hello "},
									},
								},
							},
						},
					},
				},
			},
			wantContains: []string{"Hello World"},
		},
		{
			name: "multiple elements with text",
			slide: &slides.Page{
				PageElements: []*slides.PageElement{
					{
						ObjectId: "elem1",
						Shape: &slides.Shape{
							Text: &slides.TextContent{
								TextElements: []*slides.TextElement{
									{
										StartIndex: 0,
										TextRun:    &slides.TextRun{Content: "Title"},
									},
								},
							},
						},
					},
					{
						ObjectId: "elem2",
						Shape: &slides.Shape{
							Text: &slides.TextContent{
								TextElements: []*slides.TextElement{
									{
										StartIndex: 0,
										TextRun:    &slides.TextRun{Content: "Body text"},
									},
								},
							},
						},
					},
				},
			},
			wantContains: []string{"Title", "Body text"},
		},
		{
			name: "text element without TextRun is skipped",
			slide: &slides.Page{
				PageElements: []*slides.PageElement{
					{
						ObjectId: "elem1",
						Shape: &slides.Shape{
							Text: &slides.TextContent{
								TextElements: []*slides.TextElement{
									{StartIndex: 0}, // no TextRun
									{
										StartIndex: 5,
										TextRun:    &slides.TextRun{Content: "Actual text"},
									},
								},
							},
						},
					},
				},
			},
			wantContains: []string{"Actual text"},
		},
		{
			name: "whitespace-only lines filtered out",
			slide: &slides.Page{
				PageElements: []*slides.PageElement{
					{
						ObjectId: "elem1",
						Shape: &slides.Shape{
							Text: &slides.TextContent{
								TextElements: []*slides.TextElement{
									{
										StartIndex: 0,
										TextRun:    &slides.TextRun{Content: "Line one\n   \nLine three"},
									},
								},
							},
						},
					},
				},
			},
			wantContains: []string{"Line one", "Line three"},
		},
		{
			name: "text prefixed with >",
			slide: &slides.Page{
				PageElements: []*slides.PageElement{
					{
						ObjectId: "elem1",
						Shape: &slides.Shape{
							Text: &slides.TextContent{
								TextElements: []*slides.TextElement{
									{
										StartIndex: 0,
										TextRun:    &slides.TextRun{Content: "Some text"},
									},
								},
							},
						},
					},
				},
			},
			wantContains: []string{"    > Some text"},
		},
		{
			name: "mixed elements - shape with text and non-shape",
			slide: &slides.Page{
				PageElements: []*slides.PageElement{
					{ObjectId: "img1"}, // no shape
					{
						ObjectId: "title1",
						Shape: &slides.Shape{
							Text: &slides.TextContent{
								TextElements: []*slides.TextElement{
									{
										StartIndex: 0,
										TextRun:    &slides.TextRun{Content: "Slide Title"},
									},
								},
							},
						},
					},
				},
			},
			wantContains: []string{"Slide Title"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractSlideText(tt.slide)
			if tt.wantEmpty {
				if got != "" {
					t.Errorf("extractSlideText() = %q, want empty string", got)
				}
				return
			}
			for _, want := range tt.wantContains {
				if !strings.Contains(got, want) {
					t.Errorf("extractSlideText() = %q, want to contain %q", got, want)
				}
			}
		})
	}
}

func TestFormatSlidesUpdateReplies(t *testing.T) {
	replies := []*slides.Response{
		{CreateSlide: &slides.CreateSlideResponse{ObjectId: "slide-1"}},
		{CreateShape: &slides.CreateShapeResponse{}},
		{},
	}
	want := "\n\nUpdate Results:" +
		"\n  Request 1: Created slide with ID slide-1" +
		"\n  Request 2: Created shape with ID Unknown" +
		"\n  Request 3: Operation completed"

	if got := formatSlidesUpdateReplies(replies); got != want {
		t.Errorf("formatSlidesUpdateReplies() = %q, want %q", got, want)
	}
}

func TestFormatPageElement(t *testing.T) {
	tests := []struct {
		name string
		elem *slides.PageElement
		want string
	}{
		{
			name: "shape",
			elem: &slides.PageElement{ObjectId: "shape-1", Shape: &slides.Shape{ShapeType: "TEXT_BOX"}},
			want: "  Shape: ID shape-1, Type: TEXT_BOX",
		},
		{
			name: "table",
			elem: &slides.PageElement{ObjectId: "table-1", Table: &slides.Table{Rows: 2, Columns: 3}},
			want: "  Table: ID table-1, Size: 2x3",
		},
		{
			name: "line",
			elem: &slides.PageElement{ObjectId: "line-1", Line: &slides.Line{LineType: "STRAIGHT_CONNECTOR_1"}},
			want: "  Line: ID line-1, Type: STRAIGHT_CONNECTOR_1",
		},
		{
			name: "unknown",
			elem: &slides.PageElement{},
			want: "  Element: ID Unknown, Type: Unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := formatPageElement(tt.elem); got != tt.want {
				t.Errorf("formatPageElement() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestValueOrUnknown(t *testing.T) {
	if got := valueOrUnknown(""); got != "Unknown" {
		t.Errorf("valueOrUnknown(\"\") = %q, want %q", got, "Unknown")
	}
	if got := valueOrUnknown("value"); got != "value" {
		t.Errorf("valueOrUnknown(%q) = %q, want %q", "value", got, "value")
	}
}
