package garmin

import (
	"encoding/json"
	"testing"
)

func TestClimbGradeValueDisplay(t *testing.T) {
	tests := []struct {
		name string
		g    *ClimbGradeValue
		want string
	}{
		{name: "vermin", g: &ClimbGradeValue{Scale: "VERMIN", ValueKey: "V3"}, want: "V3"},
		{name: "yds", g: &ClimbGradeValue{Scale: "YDS", ValueKey: "_5_11D"}, want: "5.11d"},
		{name: "font", g: &ClimbGradeValue{Scale: "FONT", ValueKey: "_4"}, want: "Font 4"},
		{name: "unknown", g: &ClimbGradeValue{Scale: "OTHER", ValueKey: "X"}, want: "OTHER:X"},
		{name: "empty scale", g: &ClimbGradeValue{ValueKey: "V2"}, want: "V2"},
		{name: "empty value", g: &ClimbGradeValue{Scale: "VERMIN"}, want: ""},
		{name: "nil", g: nil, want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.g.Display(); got != tt.want {
				t.Fatalf("Display() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestTypedSplitClimbingFieldsUnmarshal(t *testing.T) {
	raw := `{
		"activityId": 1,
		"activityUUID": {"uuid": "u"},
		"splits": [
			{
				"type": "CLIMB_ACTIVE",
				"status": "CLIMB_ATTEMPTED",
				"duration": 24.8,
				"messageIndex": 0,
				"gradeValue": {"sortOrder": 4, "valueKey": "V3", "scale": "VERMIN"}
			},
			{
				"type": "CLIMB_REST",
				"duration": 100,
				"messageIndex": 1
			}
		]
	}`

	var got ActivityTypedSplits
	if err := json.Unmarshal([]byte(raw), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(got.Splits) != 2 {
		t.Fatalf("splits = %d, want 2", len(got.Splits))
	}
	if got.Splits[0].Status != "CLIMB_ATTEMPTED" {
		t.Fatalf("status = %q", got.Splits[0].Status)
	}
	if got.Splits[0].GradeValue == nil || got.Splits[0].GradeValue.Display() != "V3" {
		t.Fatalf("grade = %#v", got.Splits[0].GradeValue)
	}
	if got.Splits[1].GradeValue != nil {
		t.Fatalf("rest split should have nil grade")
	}
}

func TestSplitSummaryClimbingFieldsUnmarshal(t *testing.T) {
	raw := `{
		"activityId": 1,
		"activityUUID": {"uuid": "u"},
		"splitSummaries": [
			{
				"splitType": "CLIMB_ACTIVE",
				"noOfSplits": 5,
				"numFalls": 6,
				"numClimbSends": 2,
				"numClimbsCompleted": 5,
				"mode": "ADVANCED",
				"maxGradeValue": {"sortOrder": 39, "valueKey": "_5_11D", "scale": "YDS"}
			}
		]
	}`

	var got ActivitySplitSummaries
	if err := json.Unmarshal([]byte(raw), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	s := got.SplitSummaries[0]
	if s.NumFalls != 6 || s.NumClimbSends != 2 || s.NumClimbsCompleted != 5 {
		t.Fatalf("climbing counters: falls=%d sends=%d completed=%d", s.NumFalls, s.NumClimbSends, s.NumClimbsCompleted)
	}
	if s.MaxGradeValue == nil || s.MaxGradeValue.Display() != "5.11d" {
		t.Fatalf("max grade = %#v", s.MaxGradeValue)
	}
}

func TestActivityToListItemClimbingSummary(t *testing.T) {
	a := Activity{
		ActivityID:   1,
		ActivityName: "Indoor Climbing",
		ActivityType: ActivityType{TypeKey: "indoor_climbing"},
		SplitSummaries: []SplitSummary{
			{
				SplitType:          "CLIMB_ACTIVE",
				NumFalls:           6,
				NumClimbSends:      2,
				NumClimbsCompleted: 5,
				MaxGradeValue:      &ClimbGradeValue{Scale: "YDS", ValueKey: "_5_11D"},
			},
		},
	}
	item := a.ToListItem()
	if item.NumFalls != 6 || item.NumClimbSends != 2 || item.NumClimbsDone != 5 {
		t.Fatalf("climbing summary: %+v", item)
	}
	if item.MaxClimbGrade != "5.11d" {
		t.Fatalf("MaxClimbGrade = %q", item.MaxClimbGrade)
	}
}
