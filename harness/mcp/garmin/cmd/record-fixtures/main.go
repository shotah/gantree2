// Command record-fixtures records API interactions for testing.
//
// Workflow:
//
//	make auth       # interactive login + MFA → settings.json
//	make fixtures   # record all cassettes using settings.json
//
// Omitting -cassette records every cassette.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"time"

	garmin "github.com/shotah/go-garmin/garmin"
	"github.com/shotah/go-garmin/testutil"
	"gopkg.in/dnaeon/go-vcr.v4/pkg/recorder"
)

func main() {
	date := flag.String("date", "", "Date to record (YYYY-MM-DD, defaults to today)")
	cassette := flag.String("cassette", "", "Record only this cassette (defaults to all)")
	listCassettes := flag.Bool("list", false, "List available cassettes and exit")
	flag.Parse()

	if *listCassettes {
		fmt.Println("Available cassettes:")
		names := getCassetteNames()
		for _, name := range names {
			fmt.Printf("  %s\n", name)
		}
		os.Exit(0)
	}

	settingsPath := testutil.SettingsPath()
	if !fileExists(settingsPath) {
		fmt.Fprintln(os.Stderr, "No settings.json session found.")
		fmt.Fprintln(os.Stderr, "Run interactive auth first:")
		fmt.Fprintln(os.Stderr, "  make auth")
		fmt.Fprintln(os.Stderr, "Then record fixtures:")
		fmt.Fprintln(os.Stderr, "  make fixtures")
		os.Exit(1)
	}

	if *cassette != "" {
		if !isValidCassette(*cassette) {
			fmt.Fprintf(os.Stderr, "Unknown cassette: %s\n", *cassette)
			fmt.Fprintln(os.Stderr, "Use -list to see available cassettes")
			os.Exit(1)
		}
	}

	targetDate := time.Now()
	if *date != "" {
		var err error
		targetDate, err = time.Parse("2006-01-02", *date)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Invalid date format: %s\n", *date)
			os.Exit(1)
		}
	}

	if err := recordFixtures(targetDate, *cassette); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	if *cassette != "" {
		fmt.Printf("Done! Cassette '%s' recorded to testdata/cassettes/\n", *cassette)
	} else {
		fmt.Println("Done! All cassettes recorded to testdata/cassettes/")
	}
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// cassetteRecorder defines a function that records a cassette.
type cassetteRecorder func(ctx context.Context, session []byte, date time.Time) error

// getCassetteRecorders returns a map of cassette names to their recorder functions.
func getCassetteRecorders() map[string]cassetteRecorder {
	return map[string]cassetteRecorder{
		"sleep_daily":           recordSleep,
		"wellness_stress":       recordStress,
		"wellness_body_battery": recordBodyBattery,
		"wellness_heart_rate":   recordHeartRate,
		"wellness_extended":     recordWellnessExtended,
		"wellness_daily_extra":  recordWellnessDailyExtra,
		"activities":            recordActivities,
		"hrv":                   recordHRV,
		"weight":                recordWeight,
		"metrics":               recordMetrics,
		"userprofile":           recordUserProfile,
		"devices":               recordDevices,
		"biometric":             recordBiometric,
		"workouts":              recordWorkouts,
		"calendar":              recordCalendar,
		"courses":               recordCourses,
		"courses_download":      recordCoursesDownload,
		"fitnessage":            recordFitnessAge,
		"fitnessstats":          recordFitnessStats,
		"usersummary":           recordUserSummary,
		"personalrecords":       recordPersonalRecords,
		"badges":                recordBadges,
		"bloodpressure":         recordBloodPressure,
		"periodichealth":        recordPeriodicHealth,
		"lifestyle":             recordLifestyle,
		"trainingplans":         recordTrainingPlans,
		"golf":                  recordGolf,
	}
}

// getCassetteNames returns a sorted list of available cassette names.
func getCassetteNames() []string {
	recorders := getCassetteRecorders()
	names := make([]string, 0, len(recorders))
	for name := range recorders {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// isValidCassette checks if the given name is a valid cassette.
func isValidCassette(name string) bool {
	recorders := getCassetteRecorders()
	_, ok := recorders[name]
	return ok
}

func recordFixtures(date time.Time, cassette string) error {
	ctx := context.Background()

	session, err := resolveSession()
	if err != nil {
		return err
	}

	// Step 2: Record API calls using the saved session
	recorders := getCassetteRecorders()

	// If a specific cassette is requested, only record that one
	if cassette != "" {
		fmt.Printf("Recording cassette '%s'...\n", cassette)
		recordFn := recorders[cassette]
		if err := recordFn(ctx, session, date); err != nil {
			return fmt.Errorf("%s: %w", cassette, err)
		}
		return nil
	}

	// Record all cassettes
	fmt.Println("Recording all API calls...")
	names := getCassetteNames()
	for _, name := range names {
		fmt.Printf("Recording %s...\n", name)
		recordFn := recorders[name]
		if err := recordFn(ctx, session, date); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}

	return nil
}

// stopRecorder stops the recorder and returns any error.
func stopRecorder(rec *recorder.Recorder) error {
	return rec.Stop()
}

func resolveSession() ([]byte, error) {
	path := testutil.SettingsPath()
	fmt.Printf("Using session from %s\n", path)
	session, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("settings: read %s: %w", path, err)
	}
	if len(bytes.TrimSpace(session)) == 0 {
		return nil, fmt.Errorf("settings: %s is empty; run make auth", path)
	}
	return session, nil
}

// loadSession creates a client with the recorded session loaded.
func loadSession(rec *recorder.Recorder, session []byte) (*garmin.Client, error) {
	client := garmin.New(garmin.Options{
		HTTPClient: testutil.HTTPClientWithRecorder(rec),
	})

	if err := client.LoadSession(bytes.NewReader(session)); err != nil {
		return nil, fmt.Errorf("failed to load session: %w", err)
	}

	// Keep settings.json in sync when OAuth tokens rotate mid-recording.
	path := testutil.SettingsPath()
	client.SetSessionPersister(func(c *garmin.Client) error {
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
		if err != nil {
			return err
		}
		defer f.Close()
		return c.SaveSession(f)
	})

	return client, nil
}

func recordSleep(ctx context.Context, session []byte, date time.Time) error {
	rec, err := testutil.NewRecordingRecorder("sleep_daily")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	client, err := loadSession(rec, session)
	if err != nil {
		return err
	}

	fmt.Printf("  Getting sleep data for %s...\n", date.Format("2006-01-02"))
	_, err = client.Sleep.GetDaily(ctx, date)
	if err != nil {
		fmt.Printf("  Warning: %v\n", err)
	}

	return nil
}

func recordStress(ctx context.Context, session []byte, date time.Time) error {
	rec, err := testutil.NewRecordingRecorder("wellness_stress")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	client, err := loadSession(rec, session)
	if err != nil {
		return err
	}

	fmt.Printf("  Getting stress data for %s...\n", date.Format("2006-01-02"))
	_, err = client.Wellness.GetDailyStress(ctx, date)
	if err != nil {
		fmt.Printf("  Warning: %v\n", err)
	}

	return nil
}

func recordBodyBattery(ctx context.Context, session []byte, date time.Time) error {
	rec, err := testutil.NewRecordingRecorder("wellness_body_battery")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	client, err := loadSession(rec, session)
	if err != nil {
		return err
	}

	fmt.Printf("  Getting body battery data for %s...\n", date.Format("2006-01-02"))
	_, err = client.Wellness.GetBodyBatteryEvents(ctx, date)
	if err != nil {
		fmt.Printf("  Warning: %v\n", err)
	}

	return nil
}

func recordHeartRate(ctx context.Context, session []byte, date time.Time) error {
	rec, err := testutil.NewRecordingRecorder("wellness_heart_rate")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	// Parse session to get OAuth2 token
	var authState struct {
		OAuth2AccessToken string `json:"oauth2_access_token"`
		Domain            string `json:"domain"`
	}
	if err := json.Unmarshal(session, &authState); err != nil {
		return fmt.Errorf("failed to parse session: %w", err)
	}

	httpClient := testutil.HTTPClientWithRecorder(rec)

	fmt.Printf("  Getting heart rate data for %s...\n", date.Format("2006-01-02"))
	url := fmt.Sprintf("https://connectapi.%s/wellness-service/wellness/dailyHeartRate/?date=%s",
		authState.Domain, date.Format("2006-01-02"))
	_, err = doAPIRequest(ctx, httpClient, url, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: %v\n", err)
	}

	return nil
}

func recordHRV(ctx context.Context, session []byte, date time.Time) error {
	rec, err := testutil.NewRecordingRecorder("hrv")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	// Parse session to get OAuth2 token
	var authState struct {
		OAuth2AccessToken string `json:"oauth2_access_token"`
		Domain            string `json:"domain"`
	}
	if err := json.Unmarshal(session, &authState); err != nil {
		return fmt.Errorf("failed to parse session: %w", err)
	}

	httpClient := testutil.HTTPClientWithRecorder(rec)

	// Record daily HRV
	fmt.Printf("  Getting HRV data for %s...\n", date.Format("2006-01-02"))
	dailyURL := fmt.Sprintf("https://connectapi.%s/hrv-service/hrv/%s",
		authState.Domain, date.Format("2006-01-02"))
	_, err = doAPIRequest(ctx, httpClient, dailyURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: %v\n", err)
	}

	// Record HRV range (last 7 days)
	startDate := date.AddDate(0, 0, -7)
	fmt.Printf("  Getting HRV range from %s to %s...\n", startDate.Format("2006-01-02"), date.Format("2006-01-02"))
	rangeURL := fmt.Sprintf("https://connectapi.%s/hrv-service/hrv/daily/%s/%s",
		authState.Domain, startDate.Format("2006-01-02"), date.Format("2006-01-02"))
	_, err = doAPIRequest(ctx, httpClient, rangeURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: %v\n", err)
	}

	return nil
}

func recordWeight(ctx context.Context, session []byte, date time.Time) error {
	rec, err := testutil.NewRecordingRecorder("weight")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	// Parse session to get OAuth2 token
	var authState struct {
		OAuth2AccessToken string `json:"oauth2_access_token"`
		Domain            string `json:"domain"`
	}
	if err := json.Unmarshal(session, &authState); err != nil {
		return fmt.Errorf("failed to parse session: %w", err)
	}

	httpClient := testutil.HTTPClientWithRecorder(rec)

	// Record daily weight
	fmt.Printf("  Getting weight data for %s...\n", date.Format("2006-01-02"))
	dailyURL := fmt.Sprintf("https://connectapi.%s/weight-service/weight/dayview/%s",
		authState.Domain, date.Format("2006-01-02"))
	_, err = doAPIRequest(ctx, httpClient, dailyURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: %v\n", err)
	}

	// Record weight range (last 30 days)
	startDate := date.AddDate(0, 0, -30)
	fmt.Printf("  Getting weight range from %s to %s...\n", startDate.Format("2006-01-02"), date.Format("2006-01-02"))
	rangeURL := fmt.Sprintf("https://connectapi.%s/weight-service/weight/range/%s/%s?includeAll=true",
		authState.Domain, startDate.Format("2006-01-02"), date.Format("2006-01-02"))
	_, err = doAPIRequest(ctx, httpClient, rangeURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: %v\n", err)
	}

	return nil
}

func recordActivities(ctx context.Context, session []byte, _ time.Time) error {
	rec, err := testutil.NewRecordingRecorder("activities")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	// Parse session to get OAuth2 token
	var authState struct {
		OAuth2AccessToken string `json:"oauth2_access_token"`
		Domain            string `json:"domain"`
	}
	if err := json.Unmarshal(session, &authState); err != nil {
		return fmt.Errorf("failed to parse session: %w", err)
	}

	httpClient := testutil.HTTPClientWithRecorder(rec)

	// Record activity types
	fmt.Println("  Getting activity types...")
	activityTypesURL := fmt.Sprintf("https://connectapi.%s/activity-service/activity/activityTypes", authState.Domain)
	_, err = doAPIRequest(ctx, httpClient, activityTypesURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: activity types: %v\n", err)
	}

	// Record activities list (get last 5 activities)
	fmt.Println("  Getting activities list...")
	activitiesURL := fmt.Sprintf("https://connectapi.%s/activitylist-service/activities/search/activities?start=0&limit=5", authState.Domain)
	activities, err := doAPIRequest(ctx, httpClient, activitiesURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: activities list: %v\n", err)
		return nil
	}

	if len(activities) == 0 {
		return nil
	}

	activityID, ok := activities[0]["activityId"].(float64)
	if !ok {
		return nil
	}

	// Record details, splits, and weather for the first activity
	recordActivityDetails(ctx, httpClient, authState.Domain, authState.OAuth2AccessToken, int64(activityID))

	return nil
}

func recordActivityDetails(ctx context.Context, client *http.Client, domain, token string, id int64) {
	fmt.Printf("  Getting activity details for %d...\n", id)
	activityURL := fmt.Sprintf("https://connectapi.%s/activity-service/activity/%d", domain, id)
	_, err := doAPIRequest(ctx, client, activityURL, token)
	if err != nil {
		fmt.Printf("  Warning: activity details: %v\n", err)
	}

	fmt.Printf("  Getting activity splits for %d...\n", id)
	splitsURL := fmt.Sprintf("https://connectapi.%s/activity-service/activity/%d/splits", domain, id)
	_, err = doAPIRequest(ctx, client, splitsURL, token)
	if err != nil {
		fmt.Printf("  Warning: activity splits: %v\n", err)
	}

	fmt.Printf("  Getting activity weather for %d...\n", id)
	weatherURL := fmt.Sprintf("https://connectapi.%s/activity-service/activity/%d/weather", domain, id)
	_, err = doAPIRequest(ctx, client, weatherURL, token)
	if err != nil {
		fmt.Printf("  Warning: activity weather: %v\n", err)
	}

	// Activity extension endpoints
	fmt.Printf("  Getting activity extended details for %d...\n", id)
	detailsURL := fmt.Sprintf("https://connectapi.%s/activity-service/activity/%d/details", domain, id)
	_, err = doAPIRequest(ctx, client, detailsURL, token)
	if err != nil {
		fmt.Printf("  Warning: activity extended details: %v\n", err)
	}

	fmt.Printf("  Getting activity HR time in zones for %d...\n", id)
	hrZonesURL := fmt.Sprintf("https://connectapi.%s/activity-service/activity/%d/hrTimeInZones", domain, id)
	_, err = doAPIRequest(ctx, client, hrZonesURL, token)
	if err != nil {
		fmt.Printf("  Warning: activity HR zones: %v\n", err)
	}

	fmt.Printf("  Getting activity power time in zones for %d...\n", id)
	powerZonesURL := fmt.Sprintf("https://connectapi.%s/activity-service/activity/%d/powerTimeInZones", domain, id)
	_, err = doAPIRequest(ctx, client, powerZonesURL, token)
	if err != nil {
		fmt.Printf("  Warning: activity power zones: %v\n", err)
	}

	fmt.Printf("  Getting activity exercise sets for %d...\n", id)
	exerciseSetsURL := fmt.Sprintf("https://connectapi.%s/activity-service/activity/%d/exerciseSets", domain, id)
	_, err = doAPIRequest(ctx, client, exerciseSetsURL, token)
	if err != nil {
		fmt.Printf("  Warning: activity exercise sets: %v\n", err)
	}

	fmt.Printf("  Getting activity typed splits for %d...\n", id)
	typedSplitsURL := fmt.Sprintf("https://connectapi.%s/activity-service/activity/%d/typedsplits", domain, id)
	_, err = doAPIRequest(ctx, client, typedSplitsURL, token)
	if err != nil {
		fmt.Printf("  Warning: activity typed splits: %v\n", err)
	}

	fmt.Printf("  Getting activity split summaries for %d...\n", id)
	splitSummariesURL := fmt.Sprintf("https://connectapi.%s/activity-service/activity/%d/split_summaries", domain, id)
	_, err = doAPIRequest(ctx, client, splitSummariesURL, token)
	if err != nil {
		fmt.Printf("  Warning: activity split summaries: %v\n", err)
	}
}

func recordMetrics(ctx context.Context, session []byte, date time.Time) error {
	rec, err := testutil.NewRecordingRecorder("metrics")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	// Parse session to get OAuth2 token
	var authState struct {
		OAuth2AccessToken string `json:"oauth2_access_token"`
		Domain            string `json:"domain"`
	}
	if err := json.Unmarshal(session, &authState); err != nil {
		return fmt.Errorf("failed to parse session: %w", err)
	}

	httpClient := testutil.HTTPClientWithRecorder(rec)
	dateStr := date.Format("2006-01-02")

	// Training readiness
	fmt.Printf("  Getting training readiness for %s...\n", dateStr)
	trainingReadinessURL := fmt.Sprintf("https://connectapi.%s/metrics-service/metrics/trainingreadiness/%s",
		authState.Domain, dateStr)
	_, err = doAPIRequest(ctx, httpClient, trainingReadinessURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: training readiness: %v\n", err)
	}

	// Endurance score
	fmt.Printf("  Getting endurance score for %s...\n", dateStr)
	enduranceURL := fmt.Sprintf("https://connectapi.%s/metrics-service/metrics/endurancescore?calendarDate=%s",
		authState.Domain, dateStr)
	_, err = doAPIRequest(ctx, httpClient, enduranceURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: endurance score: %v\n", err)
	}

	// Endurance score stats (weekly aggregation, last ~12 weeks)
	statsStartDate := date.AddDate(0, 0, -84)
	fmt.Printf("  Getting endurance score stats from %s to %s...\n", statsStartDate.Format("2006-01-02"), dateStr)
	enduranceStatsURL := fmt.Sprintf("https://connectapi.%s/metrics-service/metrics/endurancescore/stats?startDate=%s&endDate=%s&aggregation=weekly",
		authState.Domain, statsStartDate.Format("2006-01-02"), dateStr)
	_, err = doAPIRequest(ctx, httpClient, enduranceStatsURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: endurance score stats: %v\n", err)
	}

	// Hill score
	fmt.Printf("  Getting hill score for %s...\n", dateStr)
	hillURL := fmt.Sprintf("https://connectapi.%s/metrics-service/metrics/hillscore?calendarDate=%s",
		authState.Domain, dateStr)
	_, err = doAPIRequest(ctx, httpClient, hillURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: hill score: %v\n", err)
	}

	hillStart := date.AddDate(0, 0, -7).Format("2006-01-02")
	fmt.Printf("  Getting hill score stats %s..%s...\n", hillStart, dateStr)
	hillStatsURL := fmt.Sprintf("https://connectapi.%s/metrics-service/metrics/hillscore/stats?startDate=%s&endDate=%s&aggregation=daily",
		authState.Domain, hillStart, dateStr)
	if _, err := doAPIRequest(ctx, httpClient, hillStatsURL, authState.OAuth2AccessToken); err != nil {
		fmt.Printf("  Warning: hill score stats: %v\n", err)
	}

	// Race predictions - requires display name from user profile
	fmt.Println("  Getting social profile for display name...")
	socialProfileURL := fmt.Sprintf("https://connectapi.%s/userprofile-service/socialProfile", authState.Domain)
	profileResp, err := doAPIRequest(ctx, httpClient, socialProfileURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: social profile for race predictions: %v\n", err)
	}
	displayName := getDisplayName(profileResp)
	if displayName != "" {
		fmt.Printf("  Getting race predictions for %s...\n", displayName)
		racePredictionsURL := fmt.Sprintf("https://connectapi.%s/metrics-service/metrics/racepredictions/latest/%s",
			authState.Domain, displayName)
		_, err = doAPIRequest(ctx, httpClient, racePredictionsURL, authState.OAuth2AccessToken)
		if err != nil {
			fmt.Printf("  Warning: race predictions: %v\n", err)
		}
		fmt.Printf("  Getting daily race predictions for %s...\n", displayName)
		raceDailyURL := fmt.Sprintf("https://connectapi.%s/metrics-service/metrics/racepredictions/daily/%s?fromCalendarDate=%s&toCalendarDate=%s",
			authState.Domain, displayName, hillStart, dateStr)
		if _, err := doAPIRequest(ctx, httpClient, raceDailyURL, authState.OAuth2AccessToken); err != nil {
			fmt.Printf("  Warning: race predictions daily: %v\n", err)
		}
		fmt.Printf("  Getting monthly race predictions for %s...\n", displayName)
		raceMonthlyURL := fmt.Sprintf("https://connectapi.%s/metrics-service/metrics/racepredictions/monthly/%s?fromCalendarDate=%s&toCalendarDate=%s",
			authState.Domain, displayName, hillStart, dateStr)
		if _, err := doAPIRequest(ctx, httpClient, raceMonthlyURL, authState.OAuth2AccessToken); err != nil {
			fmt.Printf("  Warning: race predictions monthly: %v\n", err)
		}
	}

	// VO2 max / MET - latest
	fmt.Printf("  Getting latest VO2 max for %s...\n", dateStr)
	maxMetLatestURL := fmt.Sprintf("https://connectapi.%s/metrics-service/metrics/maxmet/latest/%s",
		authState.Domain, dateStr)
	_, err = doAPIRequest(ctx, httpClient, maxMetLatestURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: maxmet latest: %v\n", err)
	}

	// VO2 max / MET - daily range (last 30 days)
	startDate := date.AddDate(0, 0, -30)
	fmt.Printf("  Getting VO2 max range from %s to %s...\n", startDate.Format("2006-01-02"), dateStr)
	maxMetDailyURL := fmt.Sprintf("https://connectapi.%s/metrics-service/metrics/maxmet/daily/%s/%s",
		authState.Domain, startDate.Format("2006-01-02"), dateStr)
	_, err = doAPIRequest(ctx, httpClient, maxMetDailyURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: maxmet daily: %v\n", err)
	}

	// Training status - aggregated (requires date in path)
	fmt.Printf("  Getting aggregated training status for %s...\n", dateStr)
	trainingStatusAggURL := fmt.Sprintf("https://connectapi.%s/metrics-service/metrics/trainingstatus/aggregated/%s",
		authState.Domain, dateStr)
	_, err = doAPIRequest(ctx, httpClient, trainingStatusAggURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: training status aggregated: %v\n", err)
	}

	// Training status - daily
	fmt.Printf("  Getting daily training status for %s...\n", dateStr)
	trainingStatusDailyURL := fmt.Sprintf("https://connectapi.%s/metrics-service/metrics/trainingstatus/daily/%s",
		authState.Domain, dateStr)
	_, err = doAPIRequest(ctx, httpClient, trainingStatusDailyURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: training status daily: %v\n", err)
	}

	// Training load balance
	fmt.Printf("  Getting training load balance for %s...\n", dateStr)
	loadBalanceURL := fmt.Sprintf("https://connectapi.%s/metrics-service/metrics/trainingloadbalance/latest/%s",
		authState.Domain, dateStr)
	_, err = doAPIRequest(ctx, httpClient, loadBalanceURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: training load balance: %v\n", err)
	}

	// Heat/altitude acclimation
	fmt.Printf("  Getting heat/altitude acclimation for %s...\n", dateStr)
	acclimationURL := fmt.Sprintf("https://connectapi.%s/metrics-service/metrics/heataltitudeacclimation/latest/%s",
		authState.Domain, dateStr)
	_, err = doAPIRequest(ctx, httpClient, acclimationURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: heat/altitude acclimation: %v\n", err)
	}

	return nil
}

func recordFitnessAge(ctx context.Context, session []byte, date time.Time) error {
	rec, err := testutil.NewRecordingRecorder("fitnessage")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	// Parse session to get OAuth2 token
	var authState struct {
		OAuth2AccessToken string `json:"oauth2_access_token"`
		Domain            string `json:"domain"`
	}
	if err := json.Unmarshal(session, &authState); err != nil {
		return fmt.Errorf("failed to parse session: %w", err)
	}

	httpClient := testutil.HTTPClientWithRecorder(rec)

	// Fitness age stats (last 7 days - API limit is 28 days max)
	endDate := date.Format("2006-01-02")
	startDate := date.AddDate(0, 0, -7).Format("2006-01-02")
	fmt.Printf("  Getting fitness age stats from %s to %s...\n", startDate, endDate)
	fitnessAgeURL := fmt.Sprintf("https://connectapi.%s/fitnessage-service/stats/daily/%s/%s",
		authState.Domain, startDate, endDate)
	_, err = doAPIRequest(ctx, httpClient, fitnessAgeURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: fitness age stats: %v\n", err)
	}

	fmt.Printf("  Getting fitness age daily for %s...\n", endDate)
	dailyURL := fmt.Sprintf("https://connectapi.%s/fitnessage-service/fitnessage/%s",
		authState.Domain, endDate)
	if _, err := doAPIRequest(ctx, httpClient, dailyURL, authState.OAuth2AccessToken); err != nil {
		fmt.Printf("  Warning: fitness age daily: %v\n", err)
	}

	return nil
}

func recordFitnessStats(ctx context.Context, session []byte, date time.Time) error {
	rec, err := testutil.NewRecordingRecorder("fitnessstats")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	// Parse session to get OAuth2 token
	var authState struct {
		OAuth2AccessToken string `json:"oauth2_access_token"`
		Domain            string `json:"domain"`
	}
	if err := json.Unmarshal(session, &authState); err != nil {
		return fmt.Errorf("failed to parse session: %w", err)
	}

	httpClient := testutil.HTTPClientWithRecorder(rec)
	endDate := date.Format("2006-01-02")
	startDate := date.AddDate(0, 0, -24).Format("2006-01-02")

	// Daily activity stats with multiple metrics
	fmt.Printf("  Getting daily activity stats from %s to %s...\n", startDate, endDate)
	dailyURL := fmt.Sprintf("https://connectapi.%s/fitnessstats-service/activity?aggregation=daily&userFirstDay=monday&startDate=%s&endDate=%s&groupByActivityType=false&standardizedUnits=false&groupByParentActivityType=false&metric=duration&metric=distance&metric=calories",
		authState.Domain, startDate, endDate)
	_, err = doAPIRequest(ctx, httpClient, dailyURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: daily fitness stats: %v\n", err)
	}

	// Weekly activity stats grouped by activity type
	fmt.Printf("  Getting weekly activity stats grouped by type...\n")
	weeklyURL := fmt.Sprintf("https://connectapi.%s/fitnessstats-service/activity?aggregation=weekly&userFirstDay=monday&startDate=%s&endDate=%s&groupByActivityType=true&standardizedUnits=true&groupByParentActivityType=false&metric=calories",
		authState.Domain, startDate, endDate)
	_, err = doAPIRequest(ctx, httpClient, weeklyURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: weekly fitness stats: %v\n", err)
	}

	// Activity-level stats (no aggregation) - returns individual activity data
	fmt.Printf("  Getting activity-level stats (no aggregation)...\n")
	allURL := fmt.Sprintf("https://connectapi.%s/fitnessstats-service/activity/all?startDate=%s&endDate=%s&activityType=running&metric=startLocal&metric=activityType&metric=activitySubType&metric=name&metric=aerobicTrainingEffect&metric=anaerobicTrainingEffect",
		authState.Domain, startDate, endDate)
	_, err = doAPIRequest(ctx, httpClient, allURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: activity-level fitness stats: %v\n", err)
	}

	return nil
}

func recordUserProfile(ctx context.Context, session []byte, _ time.Time) error {
	rec, err := testutil.NewRecordingRecorder("userprofile")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	// Parse session to get OAuth2 token
	var authState struct {
		OAuth2AccessToken string `json:"oauth2_access_token"`
		Domain            string `json:"domain"`
	}
	if err := json.Unmarshal(session, &authState); err != nil {
		return fmt.Errorf("failed to parse session: %w", err)
	}

	httpClient := testutil.HTTPClientWithRecorder(rec)

	// Social profile
	fmt.Println("  Getting social profile...")
	socialProfileURL := fmt.Sprintf("https://connectapi.%s/userprofile-service/socialProfile",
		authState.Domain)
	_, err = doAPIRequest(ctx, httpClient, socialProfileURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: social profile: %v\n", err)
	}

	// User settings
	fmt.Println("  Getting user settings...")
	userSettingsURL := fmt.Sprintf("https://connectapi.%s/userprofile-service/userprofile/user-settings",
		authState.Domain)
	_, err = doAPIRequest(ctx, httpClient, userSettingsURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: user settings: %v\n", err)
	}

	// Profile settings
	fmt.Println("  Getting profile settings...")
	profileSettingsURL := fmt.Sprintf("https://connectapi.%s/userprofile-service/userprofile/settings",
		authState.Domain)
	_, err = doAPIRequest(ctx, httpClient, profileSettingsURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: profile settings: %v\n", err)
	}

	return nil
}

func recordDevices(ctx context.Context, session []byte, _ time.Time) error {
	rec, err := testutil.NewRecordingRecorder("devices")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	// Parse session to get OAuth2 token
	var authState struct {
		OAuth2AccessToken string `json:"oauth2_access_token"`
		Domain            string `json:"domain"`
	}
	if err := json.Unmarshal(session, &authState); err != nil {
		return fmt.Errorf("failed to parse session: %w", err)
	}

	httpClient := testutil.HTTPClientWithRecorder(rec)

	// List devices
	fmt.Println("  Getting device list...")
	devicesURL := fmt.Sprintf("https://connectapi.%s/device-service/deviceregistration/devices",
		authState.Domain)
	devices, err := doAPIRequest(ctx, httpClient, devicesURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: device list: %v\n", err)
	}

	// Get settings for first device if available
	if len(devices) > 0 {
		if deviceID, ok := devices[0]["deviceId"].(float64); ok {
			fmt.Printf("  Getting device settings for %d...\n", int64(deviceID))
			settingsURL := fmt.Sprintf("https://connectapi.%s/device-service/deviceservice/device-info/settings/%d",
				authState.Domain, int64(deviceID))
			_, err = doAPIRequest(ctx, httpClient, settingsURL, authState.OAuth2AccessToken)
			if err != nil {
				fmt.Printf("  Warning: device settings: %v\n", err)
			}
		}
	}

	// Device messages
	fmt.Println("  Getting device messages...")
	messagesURL := fmt.Sprintf("https://connectapi.%s/device-service/devicemessage/messages",
		authState.Domain)
	_, err = doAPIRequest(ctx, httpClient, messagesURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: device messages: %v\n", err)
	}

	// Primary training device
	fmt.Println("  Getting primary training device...")
	primaryURL := fmt.Sprintf("https://connectapi.%s/web-gateway/device-info/primary-training-device",
		authState.Domain)
	_, err = doAPIRequest(ctx, httpClient, primaryURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: primary training device: %v\n", err)
	}

	return nil
}

func recordWellnessExtended(ctx context.Context, session []byte, date time.Time) error {
	rec, err := testutil.NewRecordingRecorder("wellness_extended")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	// Parse session to get OAuth2 token
	var authState struct {
		OAuth2AccessToken string `json:"oauth2_access_token"`
		Domain            string `json:"domain"`
	}
	if err := json.Unmarshal(session, &authState); err != nil {
		return fmt.Errorf("failed to parse session: %w", err)
	}

	httpClient := testutil.HTTPClientWithRecorder(rec)
	dateStr := date.Format("2006-01-02")

	// SpO2 (blood oxygen)
	fmt.Printf("  Getting SpO2 data for %s...\n", dateStr)
	spo2URL := fmt.Sprintf("https://connectapi.%s/wellness-service/wellness/daily/spo2/%s",
		authState.Domain, dateStr)
	_, err = doAPIRequest(ctx, httpClient, spo2URL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: SpO2: %v\n", err)
	}

	// Respiration
	fmt.Printf("  Getting respiration data for %s...\n", dateStr)
	respirationURL := fmt.Sprintf("https://connectapi.%s/wellness-service/wellness/daily/respiration/%s",
		authState.Domain, dateStr)
	_, err = doAPIRequest(ctx, httpClient, respirationURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: respiration: %v\n", err)
	}

	// Intensity minutes
	fmt.Printf("  Getting intensity minutes for %s...\n", dateStr)
	imURL := fmt.Sprintf("https://connectapi.%s/wellness-service/wellness/daily/im/%s",
		authState.Domain, dateStr)
	_, err = doAPIRequest(ctx, httpClient, imURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: intensity minutes: %v\n", err)
	}

	return nil
}

func recordWellnessDailyExtra(ctx context.Context, session []byte, date time.Time) error {
	rec, err := testutil.NewRecordingRecorder("wellness_daily_extra")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	var authState struct {
		OAuth2AccessToken string `json:"oauth2_access_token"`
		Domain            string `json:"domain"`
	}
	if err := json.Unmarshal(session, &authState); err != nil {
		return fmt.Errorf("failed to parse session: %w", err)
	}

	httpClient := testutil.HTTPClientWithRecorder(rec)
	dateStr := date.Format("2006-01-02")
	startDate := date.AddDate(0, 0, -7).Format("2006-01-02")

	fmt.Printf("  Getting daily events for %s...\n", dateStr)
	eventsURL := fmt.Sprintf("https://connectapi.%s/wellness-service/wellness/dailyEvents?calendarDate=%s",
		authState.Domain, dateStr)
	if _, err := doAPIRequest(ctx, httpClient, eventsURL, authState.OAuth2AccessToken); err != nil {
		fmt.Printf("  Warning: daily events: %v\n", err)
	}

	fmt.Printf("  Getting floors chart for %s...\n", dateStr)
	floorsURL := fmt.Sprintf("https://connectapi.%s/wellness-service/wellness/floorsChartData/daily/%s",
		authState.Domain, dateStr)
	if _, err := doAPIRequest(ctx, httpClient, floorsURL, authState.OAuth2AccessToken); err != nil {
		fmt.Printf("  Warning: floors: %v\n", err)
	}

	fmt.Printf("  Getting body battery reports %s..%s...\n", startDate, dateStr)
	bbURL := fmt.Sprintf("https://connectapi.%s/wellness-service/wellness/bodyBattery/reports/daily?startDate=%s&endDate=%s",
		authState.Domain, startDate, dateStr)
	if _, err := doAPIRequest(ctx, httpClient, bbURL, authState.OAuth2AccessToken); err != nil {
		fmt.Printf("  Warning: body battery reports: %v\n", err)
	}

	fmt.Printf("  Getting sleep score stats %s..%s...\n", startDate, dateStr)
	scoreURL := fmt.Sprintf("https://connectapi.%s/wellness-service/stats/daily/sleep/score/%s/%s",
		authState.Domain, startDate, dateStr)
	if _, err := doAPIRequest(ctx, httpClient, scoreURL, authState.OAuth2AccessToken); err != nil {
		fmt.Printf("  Warning: sleep score: %v\n", err)
	}

	fmt.Println("  Getting social profile for display name...")
	socialProfileURL := fmt.Sprintf("https://connectapi.%s/userprofile-service/socialProfile", authState.Domain)
	profileResp, err := doAPIRequest(ctx, httpClient, socialProfileURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: social profile: %v\n", err)
		return nil
	}
	displayName := getDisplayName(profileResp)
	if displayName == "" {
		fmt.Println("  Warning: empty display name, skipping displayName endpoints")
		return nil
	}

	fmt.Printf("  Getting wellness daily sleep for %s...\n", displayName)
	sleepURL := fmt.Sprintf("https://connectapi.%s/wellness-service/wellness/dailySleepData/%s?date=%s&nonSleepBufferMinutes=60",
		authState.Domain, displayName, dateStr)
	if _, err := doAPIRequest(ctx, httpClient, sleepURL, authState.OAuth2AccessToken); err != nil {
		fmt.Printf("  Warning: wellness sleep: %v\n", err)
	}

	fmt.Printf("  Getting daily summary chart (steps) for %s...\n", displayName)
	stepsURL := fmt.Sprintf("https://connectapi.%s/wellness-service/wellness/dailySummaryChart/%s?date=%s",
		authState.Domain, displayName, dateStr)
	if _, err := doAPIRequest(ctx, httpClient, stepsURL, authState.OAuth2AccessToken); err != nil {
		fmt.Printf("  Warning: steps chart: %v\n", err)
	}

	return nil
}

func recordBiometric(ctx context.Context, session []byte, date time.Time) error {
	rec, err := testutil.NewRecordingRecorder("biometric")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	// Parse session to get OAuth2 token
	var authState struct {
		OAuth2AccessToken string `json:"oauth2_access_token"`
		Domain            string `json:"domain"`
	}
	if err := json.Unmarshal(session, &authState); err != nil {
		return fmt.Errorf("failed to parse session: %w", err)
	}

	httpClient := testutil.HTTPClientWithRecorder(rec)
	dateStr := date.Format("2006-01-02")
	startDate := date.AddDate(0, 0, -30)
	startDateStr := startDate.Format("2006-01-02")

	// Latest Lactate Threshold
	fmt.Println("  Getting latest lactate threshold...")
	lactateURL := fmt.Sprintf("https://connectapi.%s/biometric-service/biometric/latestLactateThreshold",
		authState.Domain)
	_, err = doAPIRequest(ctx, httpClient, lactateURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: lactate threshold: %v\n", err)
	}

	// Latest Cycling FTP
	fmt.Println("  Getting latest cycling FTP...")
	ftpURL := fmt.Sprintf("https://connectapi.%s/biometric-service/biometric/latestFunctionalThresholdPower/CYCLING",
		authState.Domain)
	_, err = doAPIRequest(ctx, httpClient, ftpURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: cycling FTP: %v\n", err)
	}

	// Power to Weight (Running)
	fmt.Printf("  Getting power to weight for %s...\n", dateStr)
	powerToWeightURL := fmt.Sprintf("https://connectapi.%s/biometric-service/biometric/powerToWeight/latest/%s?sport=Running",
		authState.Domain, dateStr)
	_, err = doAPIRequest(ctx, httpClient, powerToWeightURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: power to weight: %v\n", err)
	}

	// Lactate Threshold Speed Range
	fmt.Printf("  Getting lactate threshold speed from %s to %s...\n", startDateStr, dateStr)
	ltSpeedURL := fmt.Sprintf("https://connectapi.%s/biometric-service/stats/lactateThresholdSpeed/range/%s/%s?sport=RUNNING&aggregation=daily&aggregationStrategy=LATEST",
		authState.Domain, startDateStr, dateStr)
	_, err = doAPIRequest(ctx, httpClient, ltSpeedURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: lactate threshold speed: %v\n", err)
	}

	// Lactate Threshold Heart Rate Range
	fmt.Printf("  Getting lactate threshold heart rate from %s to %s...\n", startDateStr, dateStr)
	ltHrURL := fmt.Sprintf("https://connectapi.%s/biometric-service/stats/lactateThresholdHeartRate/range/%s/%s?sport=RUNNING&aggregation=daily&aggregationStrategy=LATEST",
		authState.Domain, startDateStr, dateStr)
	_, err = doAPIRequest(ctx, httpClient, ltHrURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: lactate threshold heart rate: %v\n", err)
	}

	// Functional Threshold Power Range (Running)
	fmt.Printf("  Getting FTP range from %s to %s...\n", startDateStr, dateStr)
	ftpRangeURL := fmt.Sprintf("https://connectapi.%s/biometric-service/stats/functionalThresholdPower/range/%s/%s?sport=RUNNING&aggregation=daily&aggregationStrategy=LATEST",
		authState.Domain, startDateStr, dateStr)
	_, err = doAPIRequest(ctx, httpClient, ftpRangeURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: FTP range: %v\n", err)
	}

	// Heart Rate Zones
	fmt.Println("  Getting heart rate zones...")
	hrZonesURL := fmt.Sprintf("https://connectapi.%s/biometric-service/heartRateZones/",
		authState.Domain)
	_, err = doAPIRequest(ctx, httpClient, hrZonesURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: heart rate zones: %v\n", err)
	}

	return nil
}

func recordWorkouts(ctx context.Context, session []byte, _ time.Time) error {
	rec, err := testutil.NewRecordingRecorder("workouts")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	// Parse session to get OAuth2 token
	var authState struct {
		OAuth2AccessToken string `json:"oauth2_access_token"`
		Domain            string `json:"domain"`
	}
	if err := json.Unmarshal(session, &authState); err != nil {
		return fmt.Errorf("failed to parse session: %w", err)
	}

	httpClient := testutil.HTTPClientWithRecorder(rec)

	// List workouts
	fmt.Println("  Getting workouts list...")
	listURL := fmt.Sprintf("https://connectapi.%s/workout-service/workouts?start=0&limit=10",
		authState.Domain)
	workouts, err := doAPIRequest(ctx, httpClient, listURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: workouts list: %v\n", err)
		return nil
	}

	// Get first workout details if any exist (no hardcoded IDs — those 404 on other accounts)
	if len(workouts) > 0 {
		if workoutID, ok := workouts[0]["workoutId"].(float64); ok {
			fmt.Printf("  Getting workout %d details...\n", int64(workoutID))
			detailURL := fmt.Sprintf("https://connectapi.%s/workout-service/workout/%d",
				authState.Domain, int64(workoutID))
			_, err = doAPIRequest(ctx, httpClient, detailURL, authState.OAuth2AccessToken)
			if err != nil {
				fmt.Printf("  Warning: workout detail: %v\n", err)
			}
		}
	} else {
		fmt.Println("  No workouts on account; skipping detail recording")
	}

	return nil
}

func recordCalendar(ctx context.Context, session []byte, date time.Time) error {
	rec, err := testutil.NewRecordingRecorder("calendar")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	// Parse session to get OAuth2 token
	var authState struct {
		OAuth2AccessToken string `json:"oauth2_access_token"`
		Domain            string `json:"domain"`
	}
	if err := json.Unmarshal(session, &authState); err != nil {
		return fmt.Errorf("failed to parse session: %w", err)
	}

	httpClient := testutil.HTTPClientWithRecorder(rec)

	// Record calendar (month is 0-indexed in Garmin API, start=1 means week starts on Monday)
	year := date.Year()
	month := int(date.Month()) - 1 // Convert to 0-indexed
	day := date.Day()

	fmt.Printf("  Getting calendar for %d/%d/%d...\n", year, month, day)
	calendarURL := fmt.Sprintf("https://connectapi.%s/calendar-service/year/%d/month/%d/day/%d/start/1",
		authState.Domain, year, month, day)
	_, err = doAPIRequest(ctx, httpClient, calendarURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: calendar: %v\n", err)
	}

	return nil
}

func recordCourses(ctx context.Context, session []byte, _ time.Time) error {
	rec, err := testutil.NewRecordingRecorder("courses")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	// Parse session to get OAuth2 token
	var authState struct {
		OAuth2AccessToken string `json:"oauth2_access_token"`
		Domain            string `json:"domain"`
	}
	if err := json.Unmarshal(session, &authState); err != nil {
		return fmt.Errorf("failed to parse session: %w", err)
	}

	httpClient := testutil.HTTPClientWithRecorder(rec)

	// List owner courses
	fmt.Println("  Getting owner courses...")
	coursesURL := fmt.Sprintf("https://connectapi.%s/web-gateway/course/owner",
		authState.Domain)
	coursesResp, err := doAPIRequest(ctx, httpClient, coursesURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: courses: %v\n", err)
		return nil
	}

	// Get first course detail
	courseID := extractFirstCourseID(coursesResp)
	if courseID != 0 {
		fmt.Printf("  Getting course detail for %d...\n", courseID)
		courseURL := fmt.Sprintf("https://connectapi.%s/course-service/course/%d",
			authState.Domain, courseID)
		_, err = doAPIRequest(ctx, httpClient, courseURL, authState.OAuth2AccessToken)
		if err != nil {
			fmt.Printf("  Warning: course detail: %v\n", err)
		}
	}

	return nil
}

func recordCoursesDownload(ctx context.Context, session []byte, _ time.Time) error {
	rec, err := testutil.NewRecordingRecorder("courses_download")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	// Parse session to get OAuth2 token
	var authState struct {
		OAuth2AccessToken string `json:"oauth2_access_token"`
		Domain            string `json:"domain"`
	}
	if err := json.Unmarshal(session, &authState); err != nil {
		return fmt.Errorf("failed to parse session: %w", err)
	}

	httpClient := testutil.HTTPClientWithRecorder(rec)

	// First get owner courses to find a course ID
	fmt.Println("  Getting owner courses for download...")
	coursesURL := fmt.Sprintf("https://connectapi.%s/web-gateway/course/owner",
		authState.Domain)
	coursesResp, err := doAPIRequest(ctx, httpClient, coursesURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: courses: %v\n", err)
		return nil
	}

	courseID := extractFirstCourseID(coursesResp)
	if courseID == 0 {
		fmt.Println("  No courses found, skipping download")
		return nil
	}

	// Download GPX
	fmt.Printf("  Downloading GPX for course %d...\n", courseID)
	gpxURL := fmt.Sprintf("https://connectapi.%s/course-service/course/gpx/%d",
		authState.Domain, courseID)
	err = doAPIRawRequest(ctx, httpClient, gpxURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: course GPX: %v\n", err)
	}

	// Download FIT
	fmt.Printf("  Downloading FIT for course %d...\n", courseID)
	fitURL := fmt.Sprintf("https://connectapi.%s/course-service/course/fit/%d/0?elevation=true",
		authState.Domain, courseID)
	err = doAPIRawRequest(ctx, httpClient, fitURL, authState.OAuth2AccessToken)
	if err != nil {
		fmt.Printf("  Warning: course FIT: %v\n", err)
	}

	return nil
}

func extractFirstCourseID(resp []map[string]any) int64 {
	if len(resp) == 0 {
		return 0
	}
	coursesForUser, ok := resp[0]["coursesForUser"].([]any)
	if !ok || len(coursesForUser) == 0 {
		return 0
	}
	firstCourse, ok := coursesForUser[0].(map[string]any)
	if !ok {
		return 0
	}
	courseID, ok := firstCourse["courseId"].(float64)
	if !ok {
		return 0
	}
	return int64(courseID)
}

func recordPersonalRecords(ctx context.Context, session []byte, _ time.Time) error {
	rec, err := testutil.NewRecordingRecorder("personalrecords")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	client, err := loadSession(rec, session)
	if err != nil {
		return err
	}
	displayName, err := client.ResolveDisplayName(ctx, "")
	if err != nil {
		fmt.Printf("  Warning: display name: %v\n", err)
		return nil
	}
	fmt.Printf("  Getting personal records for %s...\n", displayName)
	if _, err := client.PersonalRecords.List(ctx, displayName); err != nil {
		fmt.Printf("  Warning: personal records: %v\n", err)
	}
	return nil
}

func recordBadges(ctx context.Context, session []byte, _ time.Time) error {
	rec, err := testutil.NewRecordingRecorder("badges")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	client, err := loadSession(rec, session)
	if err != nil {
		return err
	}
	fmt.Println("  Getting earned badges...")
	if _, err := client.Badges.ListEarned(ctx); err != nil {
		fmt.Printf("  Warning: earned badges: %v\n", err)
	}
	fmt.Println("  Getting available badges...")
	if _, err := client.Badges.ListAvailable(ctx); err != nil {
		fmt.Printf("  Warning: available badges: %v\n", err)
	}
	fmt.Println("  Getting badge challenges...")
	if _, err := client.Badges.ListCompletedChallenges(ctx, 0, 20); err != nil {
		fmt.Printf("  Warning: completed challenges: %v\n", err)
	}
	if _, err := client.Badges.ListAvailableChallenges(ctx, 0, 20); err != nil {
		fmt.Printf("  Warning: available challenges: %v\n", err)
	}
	if _, err := client.Badges.ListNonCompletedChallenges(ctx, 0, 20); err != nil {
		fmt.Printf("  Warning: non-completed challenges: %v\n", err)
	}
	if _, err := client.Badges.ListVirtualChallengesInProgress(ctx, 0, 20); err != nil {
		fmt.Printf("  Warning: virtual challenges: %v\n", err)
	}
	if _, err := client.Badges.ListAdHocHistorical(ctx, 0, 20); err != nil {
		fmt.Printf("  Warning: adhoc challenges: %v\n", err)
	}
	return nil
}

func recordBloodPressure(ctx context.Context, session []byte, date time.Time) error {
	rec, err := testutil.NewRecordingRecorder("bloodpressure")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	client, err := loadSession(rec, session)
	if err != nil {
		return err
	}
	start := date.AddDate(0, 0, -30)
	fmt.Printf("  Getting blood pressure %s..%s...\n", start.Format("2006-01-02"), date.Format("2006-01-02"))
	if _, err := client.BloodPressure.GetRange(ctx, start, date); err != nil {
		fmt.Printf("  Warning: blood pressure: %v\n", err)
	}
	return nil
}

func recordPeriodicHealth(ctx context.Context, session []byte, date time.Time) error {
	rec, err := testutil.NewRecordingRecorder("periodichealth")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	client, err := loadSession(rec, session)
	if err != nil {
		return err
	}
	fmt.Printf("  Getting menstrual day view for %s...\n", date.Format("2006-01-02"))
	if _, err := client.PeriodicHealth.GetMenstrualDayView(ctx, date); err != nil {
		fmt.Printf("  Warning: menstrual day view: %v\n", err)
	}
	start := date.AddDate(0, 0, -90)
	fmt.Printf("  Getting menstrual calendar %s..%s...\n", start.Format("2006-01-02"), date.Format("2006-01-02"))
	if _, err := client.PeriodicHealth.GetMenstrualCalendar(ctx, start, date); err != nil {
		fmt.Printf("  Warning: menstrual calendar: %v\n", err)
	}
	fmt.Println("  Getting pregnancy snapshot...")
	if _, err := client.PeriodicHealth.GetPregnancySnapshot(ctx); err != nil {
		fmt.Printf("  Warning: pregnancy snapshot: %v\n", err)
	}
	return nil
}

func recordLifestyle(ctx context.Context, session []byte, date time.Time) error {
	rec, err := testutil.NewRecordingRecorder("lifestyle")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	client, err := loadSession(rec, session)
	if err != nil {
		return err
	}
	fmt.Printf("  Getting lifestyle log for %s...\n", date.Format("2006-01-02"))
	if _, err := client.Lifestyle.GetDaily(ctx, date); err != nil {
		fmt.Printf("  Warning: lifestyle: %v\n", err)
	}
	return nil
}

func recordTrainingPlans(ctx context.Context, session []byte, _ time.Time) error {
	rec, err := testutil.NewRecordingRecorder("trainingplans")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	client, err := loadSession(rec, session)
	if err != nil {
		return err
	}
	fmt.Println("  Getting training plans...")
	plans, err := client.TrainingPlans.List(ctx)
	if err != nil {
		fmt.Printf("  Warning: training plans: %v\n", err)
		return nil
	}
	if plans == nil || len(plans.TrainingPlanList) == 0 {
		fmt.Println("  No training plans on account")
		return nil
	}
	plan := plans.TrainingPlanList[0]
	fmt.Printf("  Getting plan detail %d (%s)...\n", plan.TrainingPlanID, plan.TrainingPlanCategory)
	if _, err := client.TrainingPlans.Get(ctx, plan.TrainingPlanID, plan.TrainingPlanCategory); err != nil {
		fmt.Printf("  Warning: plan detail: %v\n", err)
	}
	return nil
}

func recordGolf(ctx context.Context, session []byte, _ time.Time) error {
	rec, err := testutil.NewRecordingRecorder("golf")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	client, err := loadSession(rec, session)
	if err != nil {
		return err
	}
	fmt.Println("  Getting golf scorecard summaries...")
	summaries, err := client.Golf.ListScorecards(ctx, 0, 20)
	if err != nil {
		fmt.Printf("  Warning: golf summary: %v\n", err)
		return nil
	}
	id := summaries.FirstID()
	if id == 0 {
		fmt.Println("  No golf scorecards on account")
		return nil
	}
	fmt.Printf("  Getting golf scorecard detail %d...\n", id)
	if _, err := client.Golf.GetScorecard(ctx, id); err != nil {
		fmt.Printf("  Warning: golf scorecard: %v\n", err)
	}
	fmt.Printf("  Getting golf shot data for scorecard %d...\n", id)
	if _, err := client.Golf.GetShotData(ctx, id, ""); err != nil {
		fmt.Printf("  Warning: golf shots: %v\n", err)
	}
	return nil
}

func recordUserSummary(ctx context.Context, session []byte, date time.Time) error {
	rec, err := testutil.NewRecordingRecorder("usersummary")
	if err != nil {
		return err
	}
	defer func() { _ = stopRecorder(rec) }()

	client, err := loadSession(rec, session)
	if err != nil {
		return err
	}

	start := date.AddDate(0, 0, -7)
	dateStr := date.Format("2006-01-02")
	startStr := start.Format("2006-01-02")

	fmt.Println("  Resolving display name...")
	displayName, err := client.ResolveDisplayName(ctx, "")
	if err != nil {
		fmt.Printf("  Warning: display name: %v\n", err)
	} else {
		fmt.Printf("  Getting daily user summary for %s (%s)...\n", displayName, dateStr)
		if _, err := client.UserSummary.GetDaily(ctx, displayName, date); err != nil {
			fmt.Printf("  Warning: daily summary: %v\n", err)
		}
	}

	fmt.Printf("  Getting daily hydration for %s...\n", dateStr)
	if _, err := client.UserSummary.GetHydration(ctx, date); err != nil {
		fmt.Printf("  Warning: hydration: %v\n", err)
	}

	fmt.Printf("  Getting steps daily %s..%s...\n", startStr, dateStr)
	if _, err := client.UserSummary.GetStepsDaily(ctx, start, date); err != nil {
		fmt.Printf("  Warning: steps daily: %v\n", err)
	}

	fmt.Printf("  Getting steps weekly ending %s...\n", dateStr)
	if _, err := client.UserSummary.GetStepsWeekly(ctx, date, 4); err != nil {
		fmt.Printf("  Warning: steps weekly: %v\n", err)
	}

	fmt.Printf("  Getting stress daily %s..%s...\n", startStr, dateStr)
	if _, err := client.UserSummary.GetStressDaily(ctx, start, date); err != nil {
		fmt.Printf("  Warning: stress daily: %v\n", err)
	}

	fmt.Printf("  Getting stress weekly ending %s...\n", dateStr)
	if _, err := client.UserSummary.GetStressWeekly(ctx, date, 4); err != nil {
		fmt.Printf("  Warning: stress weekly: %v\n", err)
	}

	fmt.Printf("  Getting hydration stats %s..%s...\n", startStr, dateStr)
	if _, err := client.UserSummary.GetHydrationStats(ctx, start, date); err != nil {
		fmt.Printf("  Warning: hydration stats: %v\n", err)
	}

	fmt.Printf("  Getting intensity minutes daily %s..%s...\n", startStr, dateStr)
	if _, err := client.UserSummary.GetIntensityMinutesDaily(ctx, start, date); err != nil {
		fmt.Printf("  Warning: im daily: %v\n", err)
	}

	imStart := date.AddDate(0, 0, -28)
	fmt.Printf("  Getting intensity minutes weekly %s..%s...\n", imStart.Format("2006-01-02"), dateStr)
	if _, err := client.UserSummary.GetIntensityMinutesWeekly(ctx, imStart, date); err != nil {
		fmt.Printf("  Warning: im weekly: %v\n", err)
	}

	return nil
}

func doAPIRawRequest(ctx context.Context, client *http.Client, url, token string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, http.NoBody)
	if err != nil {
		return err
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("User-Agent", "GCM-iOS-5.19.1.2")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}

	// Read body to trigger VCR recording
	_, err = io.ReadAll(resp.Body)
	return err
}

func doAPIRequest(ctx context.Context, client *http.Client, url, token string) ([]map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, http.NoBody)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("User-Agent", "GCM-iOS-5.19.1.2")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result []map[string]any
	if err := json.Unmarshal(body, &result); err != nil {
		// Try single object
		var single map[string]any
		if err := json.Unmarshal(body, &single); err != nil {
			return nil, fmt.Errorf("failed to parse response: %w", err)
		}
		return []map[string]any{single}, nil
	}

	return result, nil
}

// getDisplayName extracts the displayName from a social profile response.
func getDisplayName(profileResp []map[string]any) string {
	if len(profileResp) == 0 {
		return ""
	}
	displayName, ok := profileResp[0]["displayName"].(string)
	if !ok {
		return ""
	}
	return displayName
}
