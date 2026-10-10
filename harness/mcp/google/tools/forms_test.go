package tools

import "testing"

func TestFormatFormQuestionIDs(t *testing.T) {
	tests := []struct {
		name string
		ids  any
		want string
	}{
		{name: "nil", ids: nil, want: ""},
		{name: "not a list", ids: "question-1", want: ""},
		{name: "empty list", ids: []any{}, want: ""},
		{name: "question IDs", ids: []any{"question-1", "question-2"}, want: " (Question IDs: question-1, question-2)"},
		{name: "mixed IDs", ids: []any{"question-1", 42}, want: " (Question IDs: question-1, 42)"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := formatFormQuestionIDs(tt.ids); got != tt.want {
				t.Errorf("formatFormQuestionIDs(%v) = %q, want %q", tt.ids, got, tt.want)
			}
		})
	}
}

func TestFormatFormUpdateReplies(t *testing.T) {
	tests := []struct {
		name    string
		replies []map[string]any
		want    string
	}{
		{
			name:    "no replies",
			replies: nil,
			want:    "\n\nUpdate Results:",
		},
		{
			name: "completed operation",
			replies: []map[string]any{
				{},
			},
			want: "\n\nUpdate Results:\n  Request 1: Operation completed",
		},
		{
			name: "created item with question IDs",
			replies: []map[string]any{
				{"createItem": map[string]any{"itemId": "item-1", "questionId": []any{"question-1", "question-2"}}},
			},
			want: "\n\nUpdate Results:\n  Request 1: Created item item-1 (Question IDs: question-1, question-2)",
		},
		{
			name: "created item with missing details",
			replies: []map[string]any{
				{"createItem": map[string]any{}},
			},
			want: "\n\nUpdate Results:\n  Request 1: Created item Unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := formatFormUpdateReplies(tt.replies); got != tt.want {
				t.Errorf("formatFormUpdateReplies() = %q, want %q", got, tt.want)
			}
		})
	}
}
