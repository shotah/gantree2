package garmin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

// BloodPressureMeasurement is a single BP reading.
type BloodPressureMeasurement struct {
	Version                   int     `json:"version"`
	Systolic                  int     `json:"systolic"`
	Diastolic                 int     `json:"diastolic"`
	Pulse                     *int    `json:"pulse"`
	MultiMeasurement          bool    `json:"multiMeasurement"`
	SourceType                string  `json:"sourceType"`
	Notes                     *string `json:"notes"`
	MeasurementTimestampLocal string  `json:"measurementTimestampLocal"`
	MeasurementTimestampGMT   string  `json:"measurementTimestampGMT"`
	Category                  *string `json:"category"`
	CategoryName              *string `json:"categoryName"`
	raw                       json.RawMessage
}

func (b *BloodPressureMeasurement) RawJSON() json.RawMessage { return b.raw }

func (b *BloodPressureMeasurement) SetRaw(data json.RawMessage) { b.raw = data }

// BloodPressureSummary groups measurements for a period.
type BloodPressureSummary struct {
	StartDate         string                     `json:"startDate"`
	EndDate           string                     `json:"endDate"`
	HighSystolic      *int                       `json:"highSystolic"`
	HighDiastolic     *int                       `json:"highDiastolic"`
	LowSystolic       *int                       `json:"lowSystolic"`
	LowDiastolic      *int                       `json:"lowDiastolic"`
	NumOfMeasurements int                        `json:"numOfMeasurements"`
	Category          *string                    `json:"category"`
	Measurements      []BloodPressureMeasurement `json:"measurements"`
}

// BloodPressureCategoryStats summarizes category days in a range.
type BloodPressureCategoryStats struct {
	From             string `json:"from"`
	Until            string `json:"until"`
	NoOfDaysNormal   int    `json:"noOfDaysNormal"`
	NoOfDaysElevated int    `json:"noOfDaysElevated"`
	NoOfDaysStage1   int    `json:"noOfDaysStage1"`
	NoOfDaysStage2   int    `json:"noOfDaysStage2"`
	NoOfDaysCritical int    `json:"noOfDaysCritical"`
}

// BloodPressureRange is the range response for blood pressure.
type BloodPressureRange struct {
	MeasurementSummaries []BloodPressureSummary      `json:"measurementSummaries"`
	CategoryStats        *BloodPressureCategoryStats `json:"categoryStats"`
	raw                  json.RawMessage
}

func (b *BloodPressureRange) RawJSON() json.RawMessage { return b.raw }

func (b *BloodPressureRange) SetRaw(data json.RawMessage) { b.raw = data }

// BloodPressureLogRequest is the body for logging a manual BP reading.
type BloodPressureLogRequest struct {
	MeasurementTimestampLocal string `json:"measurementTimestampLocal"`
	MeasurementTimestampGMT   string `json:"measurementTimestampGMT"`
	Systolic                  int    `json:"systolic"`
	Diastolic                 int    `json:"diastolic"`
	Pulse                     int    `json:"pulse"`
	SourceType                string `json:"sourceType"`
	Notes                     string `json:"notes,omitempty"`
}

// GetRange retrieves blood pressure measurements between start and end (inclusive).
func (s *BloodPressureService) GetRange(ctx context.Context, start, end time.Time) (*BloodPressureRange, error) {
	path := fmt.Sprintf(
		"/bloodpressure-service/bloodpressure/range/%s/%s?includeAll=true",
		start.Format("2006-01-02"),
		end.Format("2006-01-02"),
	)
	return fetch[BloodPressureRange](ctx, s.client, path)
}

// Log records a manual blood pressure measurement.
func (s *BloodPressureService) Log(ctx context.Context, req *BloodPressureLogRequest) (*BloodPressureMeasurement, error) {
	if req == nil {
		return nil, errors.New("blood pressure request is required")
	}
	if req.SourceType == "" {
		req.SourceType = "MANUAL"
	}
	return send[BloodPressureMeasurement](ctx, s.client, http.MethodPost, "/bloodpressure-service/bloodpressure", req)
}

// Delete removes a blood pressure measurement by calendar date and version.
func (s *BloodPressureService) Delete(ctx context.Context, date time.Time, version int) error {
	path := fmt.Sprintf(
		"/bloodpressure-service/bloodpressure/%s/%d",
		date.Format("2006-01-02"),
		version,
	)
	return sendEmpty(ctx, s.client, http.MethodDelete, path)
}
