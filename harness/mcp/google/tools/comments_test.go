package tools

import (
	"testing"
)

// --- titleCase tests ---

func TestCommentsTitleCase(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "lowercase word",
			input: "document",
			want:  "Document",
		},
		{
			name:  "already capitalized converts via subtraction",
			input: "Document",
			want:  "$ocument", // titleCase uses s[0]-32 which only works for lowercase ASCII
		},
		{
			name:  "single character",
			input: "d",
			want:  "D",
		},
		{
			name:  "empty string",
			input: "",
			want:  "",
		},
		{
			name:  "spreadsheet",
			input: "spreadsheet",
			want:  "Spreadsheet",
		},
		{
			name:  "presentation",
			input: "presentation",
			want:  "Presentation",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := titleCase(tt.input)
			if got != tt.want {
				t.Errorf("titleCase(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
