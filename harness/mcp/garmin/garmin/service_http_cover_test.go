package garmin

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestServicesAgainstFakeConnect(t *testing.T) {
	ctx := context.Background()
	day := time.Date(2026, 1, 15, 8, 0, 0, 0, time.UTC)
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC)
	var uris []string
	client := fakeConnectClient(t, func(r *http.Request) (*http.Response, error) {
		uris = append(uris, r.Method+" "+r.URL.RequestURI())
		status, body := connectFixture(r.Method, r.URL.Path)
		return jsonResponse(status, body), nil
	})

	acts, err := client.Activities.List(ctx, nil)
	if err != nil || len(acts) != 1 || acts[0].ActivityID != 11 || acts[0].DistanceKm() != 5 {
		t.Fatalf("list %#v err=%v", acts, err)
	}
	if acts[0].StartTime().IsZero() || acts[0].DurationTime() == 0 || acts[0].DistanceMiles() == 0 || acts[0].AveragePacePerKm() == 0 {
		t.Fatalf("activity helpers %+v", acts[0])
	}
	if acts[0].ToListItem().ActivityID != 11 || len(acts[0].RawJSON()) == 0 {
		t.Fatal("list item/raw")
	}
	zeroPace := Activity{}
	if zeroPace.AveragePacePerKm() != 0 {
		t.Fatal("zero pace")
	}
	if _, err := client.Activities.List(ctx, &ListOptions{Start: 2, Limit: 5}); err != nil {
		t.Fatal(err)
	}

	detail, err := client.Activities.Get(ctx, 11)
	if err != nil || detail.DistanceKm() != 4 || detail.DurationTime() == 0 || detail.StartTime().IsZero() {
		t.Fatalf("detail %+v err=%v", detail, err)
	}
	weather, err := client.Activities.GetWeather(ctx, 11)
	if err != nil || weather.TempCelsius() == 0 || weather.ApparentTempCelsius() == 0 {
		t.Fatalf("weather %+v err=%v", weather, err)
	}
	splits, err := client.Activities.GetSplits(ctx, 11)
	if err != nil || len(splits.LapDTOs) != 2 || splits.LapDTOs[0].DistanceKm() != 0.4 || splits.LapDTOs[1].AveragePacePerKm() != 0 {
		t.Fatalf("splits %+v err=%v", splits, err)
	}
	if splits.LapDTOs[0].DurationTime() == 0 || splits.LapDTOs[0].AveragePacePerKm() == 0 {
		t.Fatal("lap pace")
	}
	for _, download := range []func(context.Context, int64) ([]byte, error){
		client.Activities.DownloadFIT,
		client.Activities.DownloadTCX,
		client.Activities.DownloadGPX,
		client.Activities.DownloadKML,
		client.Activities.DownloadCSV,
	} {
		body, err := download(ctx, 11)
		if err != nil || string(body) != "file-bytes" {
			t.Fatalf("download %q err=%v", body, err)
		}
	}
	if _, err := client.Activities.GetPolyline(ctx, 11); err != nil {
		t.Fatal(err)
	}
	details, err := client.Activities.GetDetails(ctx, 11, &DetailOptions{MaxChartSize: 100, MaxPolylineSize: 50})
	if err != nil || details.GetMetricIndex("directHeartRate") != 1 || details.GetMetricIndex("missing") != -1 {
		t.Fatalf("details %+v err=%v", details, err)
	}
	if _, err := client.Activities.GetDetails(ctx, 11, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Activities.GetDetails(ctx, 11, &DetailOptions{}); err != nil {
		t.Fatal(err)
	}
	hr, err := client.Activities.GetHRTimeInZones(ctx, 11)
	if err != nil || len(hr.Zones) != 1 || hr.Zones[0].DurationInZone() == 0 {
		t.Fatalf("hr %+v err=%v", hr, err)
	}
	if _, err := client.Activities.GetPowerTimeInZones(ctx, 11); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Activities.GetExerciseSets(ctx, 11); err != nil {
		t.Fatal(err)
	}
	types, err := client.Activities.GetActivityTypes(ctx)
	if err != nil || len(types) != 1 || types[0].TypeKey != "running" {
		t.Fatalf("types %+v err=%v", types, err)
	}
	typed, err := client.Activities.GetTypedSplits(ctx, 11)
	if err != nil || typed.Splits[0].DistanceKm() == 0 || typed.Splits[0].DurationTime() == 0 {
		t.Fatalf("typed %+v err=%v", typed, err)
	}
	sums, err := client.Activities.GetSplitSummaries(ctx, 11)
	if err != nil || sums.SplitSummaries[0].DistanceKm() == 0 || sums.SplitSummaries[0].DurationTime() == 0 {
		t.Fatalf("summaries %+v err=%v", sums, err)
	}
	gear, err := client.Activities.GetGear(ctx, 11)
	if err != nil || len(gear.Items) != 1 || gear.Items[0].DisplayName != "Pegasus" {
		t.Fatalf("gear %+v err=%v", gear, err)
	}

	workouts, err := client.Workouts.List(ctx, 0, 20)
	if err != nil || len(workouts.Workouts) != 1 || len(workouts.RawJSON()) == 0 {
		t.Fatalf("workouts %+v err=%v", workouts, err)
	}
	if _, err := client.Workouts.Get(ctx, 4); err != nil {
		t.Fatal(err)
	}
	created, err := client.Workouts.Create(ctx, &Workout{WorkoutName: "Created"})
	if err != nil || created.WorkoutName != "Created" {
		t.Fatalf("create %+v err=%v", created, err)
	}
	updated, err := client.Workouts.Update(ctx, 4, &Workout{WorkoutName: "Updated"})
	if err != nil || updated.WorkoutName != "Updated" {
		t.Fatalf("update %+v err=%v", updated, err)
	}
	if err := client.Workouts.Delete(ctx, 4); err != nil {
		t.Fatal(err)
	}
	fit, err := client.Workouts.DownloadFIT(ctx, 4)
	if err != nil || string(fit) != "file-bytes" {
		t.Fatalf("workout fit %q err=%v", fit, err)
	}
	scheduled, err := client.Workouts.Schedule(ctx, 4, day)
	if err != nil || len(scheduled.RawJSON()) == 0 {
		t.Fatalf("schedule %+v err=%v", scheduled, err)
	}
	if _, err := client.Workouts.GetScheduled(ctx, 8); err != nil {
		t.Fatal(err)
	}
	if err := client.Workouts.Unschedule(ctx, 8); err != nil {
		t.Fatal(err)
	}

	if _, err := client.Courses.ListOwner(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Courses.Get(ctx, 2); err != nil {
		t.Fatal(err)
	}
	saved, err := client.Courses.Import(ctx, "loop.gpx", strings.NewReader("<gpx/>"), 5, 4)
	if err != nil || saved.CourseName != "Saved" {
		t.Fatalf("import %+v err=%v", saved, err)
	}
	saved, err = client.Courses.Import(ctx, "loop.gpx", strings.NewReader("<gpx/>"), 0, 0)
	if err != nil || saved.CourseName != "Saved" {
		t.Fatalf("import defaults %+v err=%v", saved, err)
	}
	gpx, err := client.Courses.DownloadGPX(ctx, 2)
	if err != nil || string(gpx) != "file-bytes" {
		t.Fatal(err)
	}
	courseFIT, err := client.Courses.DownloadFIT(ctx, 2)
	if err != nil || string(courseFIT) != "file-bytes" {
		t.Fatal(err)
	}
	if err := client.Courses.Delete(ctx, 2); err != nil {
		t.Fatal(err)
	}

	readiness, err := client.Metrics.GetTrainingReadiness(ctx, day)
	if err != nil || len(readiness.RawJSON()) == 0 {
		t.Fatal(err)
	}
	if _, err := client.Metrics.GetEnduranceScore(ctx, day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Metrics.GetEnduranceScoreStats(ctx, start, end, AggregationDaily); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Metrics.GetHillScore(ctx, day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Metrics.GetHillScoreStats(ctx, start, end, AggregationWeekly); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Metrics.GetMaxMetLatest(ctx, day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Metrics.GetMaxMetDaily(ctx, start, end); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Metrics.GetTrainingStatusAggregated(ctx, day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Metrics.GetTrainingStatusDaily(ctx, day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Metrics.GetTrainingLoadBalance(ctx, day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Metrics.GetHeatAltitudeAcclimation(ctx, day); err != nil {
		t.Fatal(err)
	}
	preds, err := client.Metrics.GetRacePredictionsLatest(ctx, "ada")
	if err != nil {
		t.Fatal(err)
	}
	_ = preds.Time5KDuration()
	_ = preds.Time10KDuration()
	_ = preds.TimeHalfMarathonDuration()
	_ = preds.TimeMarathonDuration()
	if _, err := client.Metrics.GetRacePredictionsDaily(ctx, "ada", start, end); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Metrics.GetRacePredictionsMonthly(ctx, "ada", start, end); err != nil {
		t.Fatal(err)
	}

	lt, err := client.Biometric.GetLatestLactateThreshold(ctx)
	if err != nil || lt.Speed() == nil || lt.HeartRate() == nil || lt.RawJSON() == nil {
		t.Fatalf("lt %+v err=%v", lt, err)
	}
	if _, err := client.Biometric.GetCyclingFTP(ctx); err != nil {
		t.Fatal(err)
	}
	ptw, err := client.Biometric.GetPowerToWeight(ctx, day)
	if err != nil || ptw.RawJSON() == nil {
		t.Fatal(err)
	}
	if _, err := client.Biometric.GetHeartRateZones(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Biometric.GetLactateThresholdSpeedRange(ctx, start, end); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Biometric.GetLactateThresholdHRRange(ctx, start, end); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Biometric.GetFTPRange(ctx, start, end); err != nil {
		t.Fatal(err)
	}

	devices, err := client.Devices.GetDevices(ctx)
	if err != nil || len(devices) != 1 || devices[0].RawJSON() == nil {
		t.Fatalf("devices %+v err=%v", devices, err)
	}
	if _, err := client.Devices.GetSettings(ctx, 9); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Devices.GetMessages(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Devices.GetPrimaryTrainingDevice(ctx); err != nil {
		t.Fatal(err)
	}

	if _, err := client.Badges.ListEarned(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Badges.ListAvailable(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Badges.ListCompletedChallenges(ctx, 0, 10); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Badges.ListAvailableChallenges(ctx, 0, 10); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Badges.ListNonCompletedChallenges(ctx, 0, 10); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Badges.ListVirtualChallengesInProgress(ctx, 0, 10); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Badges.ListAdHocHistorical(ctx, 0, 10); err != nil {
		t.Fatal(err)
	}

	name, err := client.ResolveDisplayName(ctx, "")
	if err != nil || name != "ada" {
		t.Fatalf("display %q err=%v", name, err)
	}
	if got, err := client.ResolveDisplayName(ctx, "override"); err != nil || got != "override" {
		t.Fatalf("override %q err=%v", got, err)
	}
	if _, err := client.UserProfile.GetSocialProfile(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UserProfile.GetUserSettings(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UserProfile.GetProfileSettings(ctx); err != nil {
		t.Fatal(err)
	}

	if _, err := client.Wellness.GetDailyStress(ctx, day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Wellness.GetBodyBatteryEvents(ctx, day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Wellness.GetDailyHeartRate(ctx, day); err != nil {
		t.Fatal(err)
	}
	spo2, err := client.Wellness.GetDailySpO2(ctx, day)
	if err != nil || spo2.RawJSON() == nil {
		t.Fatal(err)
	}
	if _, err := client.Wellness.GetDailyRespiration(ctx, day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Wellness.GetDailyIntensityMinutes(ctx, day); err != nil {
		t.Fatal(err)
	}
	events, err := client.Wellness.GetDailyEvents(ctx, day)
	if err != nil {
		t.Fatal(err)
	}
	if encoded, err := json.Marshal(events); err != nil || !strings.Contains(string(encoded), "event") {
		t.Fatalf("events json %s err=%v", encoded, err)
	}
	if _, err := client.Wellness.GetDailySleep(ctx, "ada", day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Wellness.GetDailySummaryChart(ctx, "ada", day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Wellness.GetDailyFloors(ctx, day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Wellness.GetBodyBatteryReports(ctx, start, end); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Wellness.GetSleepScoreStats(ctx, start, end); err != nil {
		t.Fatal(err)
	}

	if _, err := client.UserSummary.GetDaily(ctx, "ada", day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UserSummary.GetHydration(ctx, day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UserSummary.LogHydration(ctx, nil); err == nil {
		t.Fatal("nil hydration")
	}
	if _, err := client.UserSummary.LogHydration(ctx, &HydrationLogRequest{}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UserSummary.GetStepsDaily(ctx, end, start); err == nil {
		t.Fatal("reversed steps range")
	}
	if _, err := client.UserSummary.GetStepsDaily(ctx, start, end); err != nil {
		t.Fatal(err)
	}
	longEnd := start.AddDate(0, 0, 40)
	steps, err := client.UserSummary.GetStepsDaily(ctx, start, longEnd)
	if err != nil || steps.RawJSON() == nil {
		t.Fatal(err)
	}
	if _, err := client.UserSummary.GetStepsWeekly(ctx, end, 0); err == nil {
		t.Fatal("weeks")
	}
	if _, err := client.UserSummary.GetStepsWeekly(ctx, end, 4); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UserSummary.GetStressDaily(ctx, start, end); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UserSummary.GetStressWeekly(ctx, end, 0); err == nil {
		t.Fatal("stress weeks")
	}
	if _, err := client.UserSummary.GetStressWeekly(ctx, end, 4); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UserSummary.GetHydrationStats(ctx, start, end); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UserSummary.GetIntensityMinutesDaily(ctx, start, end); err != nil {
		t.Fatal(err)
	}
	if _, err := client.UserSummary.GetIntensityMinutesWeekly(ctx, start, end); err != nil {
		t.Fatal(err)
	}

	if _, err := client.Sleep.GetDaily(ctx, day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.HRV.GetDaily(ctx, day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.HRV.GetRange(ctx, start, end); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Weight.GetDaily(ctx, day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Weight.GetRange(ctx, start, end); err != nil {
		t.Fatal(err)
	}
	if _, err := client.BloodPressure.GetRange(ctx, start, end); err != nil {
		t.Fatal(err)
	}
	if _, err := client.BloodPressure.Log(ctx, &BloodPressureLogRequest{}); err != nil {
		t.Fatal(err)
	}
	if err := client.BloodPressure.Delete(ctx, day, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Lifestyle.GetDaily(ctx, day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Lifestyle.CreateBehaviour(ctx, &LifestyleBehaviourRequest{Name: "Meditation"}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.TrainingPlans.List(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.TrainingPlans.GetPhased(ctx, 3); err != nil {
		t.Fatal(err)
	}
	if _, err := client.TrainingPlans.GetAdaptive(ctx, 3); err != nil {
		t.Fatal(err)
	}
	if _, err := client.TrainingPlans.Get(ctx, 3, "FBT_ADAPTIVE"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.TrainingPlans.Get(ctx, 3, "PHASED"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.PeriodicHealth.GetMenstrualDayView(ctx, day); err != nil {
		t.Fatal(err)
	}
	if _, err := client.PeriodicHealth.GetMenstrualCalendar(ctx, start, end); err != nil {
		t.Fatal(err)
	}
	if _, err := client.PeriodicHealth.GetPregnancySnapshot(ctx); err != nil {
		t.Fatal(err)
	}

	joined := strings.Join(uris, "\n")
	for _, needle := range []string{"start=0&limit=20", "start=2&limit=5", "maxChartSize=100", "maxPolylineSize=50"} {
		if !strings.Contains(joined, needle) {
			t.Errorf("missing %s in requests", needle)
		}
	}
}

func TestServiceHTTPFailures(t *testing.T) {
	ctx := context.Background()
	day := time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		name    string
		status  int
		body    string
		call    func(*Client) error
		wantErr string
	}{
		{
			name:   "list bad json",
			status: http.StatusOK,
			body:   `{`,
			call: func(c *Client) error {
				_, err := c.Activities.List(ctx, nil)
				return err
			},
			wantErr: "JSON",
		},
		{
			name:   "get not found",
			status: http.StatusNoContent,
			call: func(c *Client) error {
				_, err := c.Activities.Get(ctx, 1)
				return err
			},
			wantErr: ErrNotFound.Error(),
		},
		{
			name:   "workout list status",
			status: http.StatusBadGateway,
			body:   "down",
			call: func(c *Client) error {
				_, err := c.Workouts.List(ctx, 0, 1)
				return err
			},
			wantErr: "status 502",
		},
		{
			name:   "workout list bad json",
			status: http.StatusOK,
			body:   `{`,
			call: func(c *Client) error {
				_, err := c.Workouts.List(ctx, 0, 1)
				return err
			},
			wantErr: "unmarshal",
		},
		{
			name:   "update not found",
			status: http.StatusNotFound,
			body:   "missing",
			call: func(c *Client) error {
				_, err := c.Workouts.Update(ctx, 4, &Workout{})
				return err
			},
			wantErr: ErrNotFound.Error(),
		},
		{
			name:   "update status",
			status: http.StatusInternalServerError,
			body:   "nope",
			call: func(c *Client) error {
				_, err := c.Workouts.Update(ctx, 4, &Workout{})
				return err
			},
			wantErr: "status 500",
		},
		{
			name:   "update bad json",
			status: http.StatusOK,
			body:   `{`,
			call: func(c *Client) error {
				_, err := c.Workouts.Update(ctx, 4, &Workout{})
				return err
			},
			wantErr: "unmarshal",
		},
		{
			name:   "schedule not found",
			status: http.StatusNotFound,
			call: func(c *Client) error {
				_, err := c.Workouts.Schedule(ctx, 4, day)
				return err
			},
			wantErr: ErrNotFound.Error(),
		},
		{
			name:   "schedule status",
			status: http.StatusInternalServerError,
			body:   "nope",
			call: func(c *Client) error {
				_, err := c.Workouts.Schedule(ctx, 4, day)
				return err
			},
			wantErr: "status 500",
		},
		{
			name:   "schedule bad json",
			status: http.StatusOK,
			body:   `{`,
			call: func(c *Client) error {
				_, err := c.Workouts.Schedule(ctx, 4, day)
				return err
			},
			wantErr: "unmarshal",
		},
		{
			name:   "download not found",
			status: http.StatusNotFound,
			call: func(c *Client) error {
				_, err := c.Workouts.DownloadFIT(ctx, 4)
				return err
			},
			wantErr: ErrNotFound.Error(),
		},
		{
			name:   "download status",
			status: http.StatusInternalServerError,
			body:   "nope",
			call: func(c *Client) error {
				_, err := c.Workouts.DownloadFIT(ctx, 4)
				return err
			},
			wantErr: "status 500",
		},
		{
			name:   "course download not found",
			status: http.StatusNotFound,
			call: func(c *Client) error {
				_, err := c.Courses.DownloadGPX(ctx, 2)
				return err
			},
			wantErr: ErrNotFound.Error(),
		},
		{
			name:   "course fit not found",
			status: http.StatusNotFound,
			call: func(c *Client) error {
				_, err := c.Courses.DownloadFIT(ctx, 2)
				return err
			},
			wantErr: ErrNotFound.Error(),
		},
		{
			name:   "activity download not found",
			status: http.StatusNotFound,
			call: func(c *Client) error {
				_, err := c.Activities.DownloadGPX(ctx, 2)
				return err
			},
			wantErr: ErrNotFound.Error(),
		},
		{
			name:   "delete status",
			status: http.StatusInternalServerError,
			body:   "nope",
			call: func(c *Client) error {
				return c.Workouts.Delete(ctx, 4)
			},
			wantErr: "Internal Server Error",
		},
		{
			name:   "send status",
			status: http.StatusInternalServerError,
			body:   "nope",
			call: func(c *Client) error {
				_, err := c.Workouts.Create(ctx, &Workout{})
				return err
			},
			wantErr: "Internal Server Error",
		},
		{
			name:   "send bad json",
			status: http.StatusOK,
			body:   `{`,
			call: func(c *Client) error {
				_, err := c.Workouts.Create(ctx, &Workout{})
				return err
			},
			wantErr: "unmarshal",
		},
		{
			name:   "devices not found",
			status: http.StatusNotFound,
			call: func(c *Client) error {
				_, err := c.Devices.GetDevices(ctx)
				return err
			},
			wantErr: ErrNotFound.Error(),
		},
		{
			name:   "devices bad json",
			status: http.StatusOK,
			body:   `{`,
			call: func(c *Client) error {
				_, err := c.Devices.GetDevices(ctx)
				return err
			},
		},
		{
			name:   "power to weight empty",
			status: http.StatusOK,
			body:   `[]`,
			call: func(c *Client) error {
				_, err := c.Biometric.GetPowerToWeight(ctx, day)
				return err
			},
			wantErr: ErrNotFound.Error(),
		},
		{
			name:   "power to weight not found",
			status: http.StatusNoContent,
			call: func(c *Client) error {
				_, err := c.Biometric.GetPowerToWeight(ctx, day)
				return err
			},
			wantErr: ErrNotFound.Error(),
		},
		{
			name:   "power to weight bad json",
			status: http.StatusOK,
			body:   `{`,
			call: func(c *Client) error {
				_, err := c.Biometric.GetPowerToWeight(ctx, day)
				return err
			},
		},
		{
			name:   "activity types bad json",
			status: http.StatusOK,
			body:   `{`,
			call: func(c *Client) error {
				_, err := c.Activities.GetActivityTypes(ctx)
				return err
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client := fakeConnectClient(t, func(*http.Request) (*http.Response, error) {
				return jsonResponse(tc.status, tc.body), nil
			})
			err := tc.call(client)
			if err == nil {
				t.Fatal("expected error")
			}
			if tc.wantErr != "" && !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("err=%v, want %q", err, tc.wantErr)
			}
		})
	}
}

func TestFetchAndUploadEdges(t *testing.T) {
	ctx := context.Background()
	readErr := fakeConnectClient(t, func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Header:     make(http.Header),
			Body:       errReadCloser{},
		}, nil
	})
	if _, err := readErr.Activities.Get(ctx, 1); err == nil {
		t.Fatal("expected read error")
	}

	client := fakeConnectClient(t, func(*http.Request) (*http.Response, error) {
		return nil, errors.New("dial")
	})
	if _, err := client.doAPI(ctx, http.MethodGet, "/x", http.NoBody); err == nil {
		t.Fatal("expected transport error")
	}
	if _, err := client.doAPI(ctx, http.MethodPost, "/x", errReadCloser{}); err == nil {
		t.Fatal("expected body read error")
	}
	if _, err := client.doAPIWithBody(ctx, http.MethodPost, "/x", errReadCloser{}); err == nil {
		t.Fatal("expected body read error")
	}
	if _, err := client.doAPIMultipart(ctx, "/x", "file", "a.gpx", errReadCloser{}); err == nil {
		t.Fatal("expected copy error")
	}

	// send's request value cannot be marshaled.
	if _, err := send[rawBox](ctx, client, http.MethodPost, "/x", make(chan int)); err == nil || !strings.Contains(err.Error(), "marshal") {
		t.Fatalf("marshal err=%v", err)
	}

	badUpload := fakeConnectClient(t, func(*http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusBadRequest, "no"), nil
	})
	if _, err := upload[CourseDetail](ctx, badUpload, "/course-service/course/import", "file", "a.gpx", strings.NewReader("gpx")); err == nil {
		t.Fatal("expected upload status error")
	}
	badJSON := fakeConnectClient(t, func(*http.Request) (*http.Response, error) {
		return jsonResponse(http.StatusOK, `{`), nil
	})
	if _, err := upload[CourseDetail](ctx, badJSON, "/course-service/course/import", "file", "a.gpx", strings.NewReader("gpx")); err == nil {
		t.Fatal("expected upload json error")
	}
	if _, err := upload[CourseDetail](ctx, readErr, "/course-service/course/import", "file", "a.gpx", strings.NewReader("gpx")); err == nil {
		t.Fatal("expected upload read error")
	}
}

func TestCourseSaveRequestAndParsing(t *testing.T) {
	empty := newSaveCourseRequest(&CourseDetail{CourseName: "empty"})
	if empty.CourseName != "empty" || len(empty.GeoPoints) != 0 {
		t.Fatalf("empty %+v", empty)
	}
	cs := "WGS84"
	dist := 12.5
	full := newSaveCourseRequest(&CourseDetail{
		CourseName:         "loop",
		DistanceMeter:      10,
		ElevationGainMeter: 3,
		ElevationLossMeter: 1,
		StartPoint:         StartPoint{Latitude: 1, Longitude: 2, Elevation: 3},
		BoundingBox:        BoundingBox{LowerLeftLatIsSet: true},
		GeoPoints: []GeoPoint{
			{Latitude: 10, Longitude: 20, Elevation: 5, Distance: 0},
			{Latitude: 12, Longitude: 18, Elevation: 9, Distance: dist},
			{Latitude: 9, Longitude: 21, Elevation: 4, Distance: 20},
		},
		CourseLines: []CourseLine{
			{SortOrder: 1, NumberOfPoints: 3},
			{SortOrder: 2, CoordinateSystem: &cs},
		},
	})
	if full.StartPoint.Latitude != 1 || !full.BoundingBox.LowerLeftLatIsSet || full.DistanceMeter != 10 {
		t.Fatalf("kept existing metadata %+v", full)
	}
	if full.CourseLines[0].CoordinateSystem == "" || full.CourseLines[1].CoordinateSystem != "WGS84" {
		t.Fatalf("lines %+v", full.CourseLines)
	}

	computed := newSaveCourseRequest(&CourseDetail{
		GeoPoints: []GeoPoint{
			{Latitude: 10, Longitude: 20, Elevation: 5, Distance: 0},
			{Latitude: 12, Longitude: 18, Elevation: 15, Distance: 100},
			{Latitude: 9, Longitude: 22, Elevation: 8, Distance: 180},
		},
	})
	if computed.StartPoint.Latitude != 10 || computed.DistanceMeter != 180 || computed.ElevationGainMeter == 0 || computed.ElevationLossMeter == 0 {
		t.Fatalf("computed %+v", computed)
	}
	if !computed.BoundingBox.LowerLeftLatIsSet || computed.BoundingBox.LowerLeft.Latitude != 9 {
		t.Fatalf("bbox %+v", computed.BoundingBox)
	}

	var races RacePredictionsList
	if err := json.Unmarshal([]byte(`{"time5K":12}`), &races); err != nil || len(races.Entries) != 1 {
		t.Fatalf("object races %+v err=%v", races, err)
	}
	if err := json.Unmarshal([]byte(`{`), &races); err == nil {
		t.Fatal("expected races error")
	}
	preds := RacePredictions{Time5K: 1, Time10K: 2, TimeHalfMarathon: 3, TimeMarathon: 4}
	if preds.Time5KDuration() == 0 || preds.TimeMarathonDuration() == 0 {
		t.Fatal("durations")
	}

	var badges BadgeList
	if err := json.Unmarshal([]byte(`{"badgeList":[{}]}`), &badges); err != nil || len(badges.Entries) != 1 {
		t.Fatalf("badges %+v err=%v", badges, err)
	}
	if err := json.Unmarshal([]byte(`{`), &badges); err == nil {
		t.Fatal("expected badge error")
	}
	var challenges BadgeChallengeList
	if err := json.Unmarshal([]byte(`{"virtualChallengeList":[{"name":"v"}]}`), &challenges); err != nil || len(challenges.Entries) != 1 {
		t.Fatalf("challenges %+v err=%v", challenges, err)
	}
	if err := json.Unmarshal([]byte(`{"nope":1}`), &challenges); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(`{`), &challenges); err == nil {
		t.Fatal("expected challenge error")
	}

	var events DailyEvents
	if encoded, err := events.MarshalJSON(); err != nil || string(encoded) != "{}" {
		t.Fatalf("empty events %s err=%v", encoded, err)
	}
	events.raw = []byte(`{"event":1}`)
	if encoded, err := events.MarshalJSON(); err != nil || !strings.Contains(string(encoded), "event") {
		t.Fatalf("raw events %s err=%v", encoded, err)
	}

	var emptyLT LactateThreshold
	if emptyLT.Speed() != nil || emptyLT.HeartRate() != nil {
		t.Fatal("empty lactate")
	}
}

func TestHostManifest(t *testing.T) {
	var buf strings.Builder
	if err := WriteHostManifest(&buf); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), `"name":"garmin"`) && !strings.Contains(buf.String(), `"name": "garmin"`) {
		t.Fatalf("manifest %s", buf.String())
	}
}

func fakeConnectClient(t *testing.T, rt roundTripFunc) *Client {
	t.Helper()
	client := New(Options{
		HTTPClient: &http.Client{Transport: rt},
		RateLimit:  &RateLimitConfig{RequestsPerMinute: 60000, BurstSize: 1000},
		Retry:      &RetryConfig{MaxRetries: 0, InitialBackoff: time.Millisecond, MaxBackoff: time.Millisecond},
	})
	client.auth = &authState{
		OAuth2AccessToken:  "test-access",
		OAuth2RefreshToken: "test-refresh",
		OAuth2Expiry:       time.Now().Add(time.Hour),
		Domain:             "garmin.com",
	}
	return client
}

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Status:     http.StatusText(status),
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

type rawBox struct {
	raw json.RawMessage
}

type errReadCloser struct{}

func (errReadCloser) Read([]byte) (int, error) { return 0, errors.New("read failed") }
func (errReadCloser) Close() error             { return nil }

func (r *rawBox) SetRaw(data json.RawMessage) { r.raw = data }
func (r *rawBox) RawJSON() json.RawMessage    { return r.raw }

func connectFixture(method, path string) (int, string) {
	switch {
	case strings.Contains(path, "/download-service/"),
		strings.Contains(path, "/course/gpx/"),
		strings.Contains(path, "/course/fit/"),
		strings.Contains(path, "/workout/FIT/"):
		return http.StatusOK, "file-bytes"
	case strings.Contains(path, "/activitylist-service/"):
		return http.StatusOK, `[{"activityId":11,"activityName":"Morning Run","startTimeGMT":"2026-01-02 15:04:05","distance":5000,"duration":1500}]`
	case strings.Contains(path, "/hrTimeInZones"), strings.Contains(path, "/powerTimeInZones"):
		return http.StatusOK, `[{"zoneNumber":2,"secsInZone":45}]`
	case strings.Contains(path, "filterGear"):
		return http.StatusOK, `[{"gearPk":3,"displayName":"Pegasus"}]`
	case strings.Contains(path, "/activityTypes"):
		return http.StatusOK, `[{"typeId":1,"typeKey":"running"}]`
	case strings.Contains(path, "/splits"):
		return http.StatusOK, `{"activityId":11,"lapDTOs":[{"duration":60,"distance":400},{"duration":30,"distance":0}]}`
	case strings.Contains(path, "/weather"):
		return http.StatusOK, `{"temp":70,"apparentTemp":72}`
	case strings.Contains(path, "/details"):
		return http.StatusOK, `{"activityId":11,"metricDescriptors":[{"metricsIndex":1,"key":"directHeartRate"}]}`
	case strings.Contains(path, "/exerciseSets"):
		return http.StatusOK, `{"activityId":11}`
	case strings.Contains(path, "/typedsplits"):
		return http.StatusOK, `{"activityId":11,"splits":[{"duration":10,"distance":100}]}`
	case strings.Contains(path, "/split_summaries"):
		return http.StatusOK, `{"activityId":11,"splitSummaries":[{"duration":10,"distance":100}]}`
	case strings.Contains(path, "/activity-service/activity/"):
		return http.StatusOK, `{"activityId":11,"summaryDTO":{"startTimeGMT":"2026-01-02T15:04:05.0","duration":1200,"distance":4000}}`
	case strings.Contains(path, "/workout-service/workouts"):
		return http.StatusOK, `[{"workoutId":4,"workoutName":"Intervals"}]`
	case method == http.MethodPut && strings.Contains(path, "/workout-service/workout/"):
		return http.StatusOK, `{"workoutId":4,"workoutName":"Updated"}`
	case method == http.MethodPost && strings.Contains(path, "/workout-service/schedule/"):
		return http.StatusOK, `{"scheduleId":8,"workoutId":4}`
	case strings.Contains(path, "/workout-service/schedule/"):
		return http.StatusOK, `{"scheduleId":8}`
	case strings.Contains(path, "/workout-service/workout"):
		return http.StatusOK, `{"workoutId":4,"workoutName":"Created"}`
	case strings.Contains(path, "/course/import"):
		return http.StatusOK, `{
			"courseName":"Loop",
			"geoPoints":[
				{"latitude":10,"longitude":20,"elevation":5,"distance":0},
				{"latitude":12,"longitude":18,"elevation":15,"distance":100},
				{"latitude":9,"longitude":22,"elevation":8,"distance":180}
			],
			"courseLines":[{"sortOrder":1,"numberOfPoints":3,"distanceInMeters":180}]
		}`
	case method == http.MethodPost && path == "/course-service/course":
		return http.StatusOK, `{"courseId":2,"courseName":"Saved"}`
	case strings.Contains(path, "/course/owner"):
		return http.StatusOK, `{}`
	case strings.Contains(path, "/course-service/course/"):
		return http.StatusOK, `{"courseId":2,"courseName":"Loop"}`
	case method == http.MethodDelete:
		return http.StatusNoContent, ""
	case strings.Contains(path, "/socialProfile"):
		return http.StatusOK, `{"displayName":"ada"}`
	case strings.Contains(path, "/deviceregistration/devices"):
		return http.StatusOK, `[{"deviceId":9}]`
	case strings.Contains(path, "latestLactateThreshold"):
		speed := `[{"speed":3.2,"hearRate":160}]`
		return http.StatusOK, speed
	case strings.Contains(path, "powerToWeight"):
		return http.StatusOK, `[{"userProfilePK":1}]`
	case strings.Contains(path, "/dailyEvents"):
		return http.StatusOK, `{"event":1}`
	case wantsJSONArray(path):
		return http.StatusOK, `[]`
	default:
		return http.StatusOK, `{}`
	}
}

func wantsJSONArray(path string) bool {
	needles := []string{
		"trainingreadiness",
		"/maxmet/daily/",
		"racepredictions/daily",
		"racepredictions/monthly",
		"heartRateZones",
		"lactateThresholdSpeed",
		"lactateThresholdHeartRate",
		"functionalThresholdPower/range",
		"/badge/earned",
		"/badge/available",
		"badgeChallenge",
		"virtualChallenge",
		"adHocChallenge",
		"/stats/",
		"bodyBattery/events",
		"bodyBattery/reports",
		"/sleep/score/",
		"dailySummaryChart",
	}
	for _, needle := range needles {
		if strings.Contains(path, needle) {
			return true
		}
	}
	return false
}
