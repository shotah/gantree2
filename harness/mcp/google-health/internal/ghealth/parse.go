package ghealth

import (
	"math"
	"path"
	"sort"
	"strings"
	"time"
)

// sleepAPINote tells the agent the app score is not on this data type.
const sleepAPINote = "Google Health does not return the app Sleep Score (0-100). efficiency is round(minutes asleep / minutes in the sleep period * 100). stages_minutes are deep, light, rem, and awake."

var sleepScoreKeys = []string{"sleepScore", "sleep_score", "score"}

func mapSleep(m map[string]any) (SleepResult, bool) {
	sleep := asMap(m["sleep"])
	if sleep == nil {
		return SleepResult{}, false
	}
	interval := asMap(sleep["interval"])
	summary := asMap(sleep["summary"])
	meta := asMap(sleep["metadata"])
	minsAsleep := parseFloatish(summary["minutesAsleep"])
	minsInBed := parseFloatish(summary["minutesInSleepPeriod"])
	efficiency := 0.0
	if minsInBed > 0 && minsAsleep > 0 {
		efficiency = math.Round((minsAsleep / minsInBed) * 100)
	}
	res := SleepResult{
		Date:                 sessionWakeDay(interval),
		Main:                 isMainSleep(meta),
		Nap:                  boolField(meta, "nap"),
		DurationMinutes:      minsAsleep,
		Efficiency:           efficiency,
		MinutesAwake:         parseFloatish(summary["minutesAwake"]),
		MinutesInSleepPeriod: minsInBed,
		MinutesToFallAsleep:  parseFloatish(summary["minutesToFallAsleep"]),
		MinutesAfterWakeup:   parseFloatish(summary["minutesAfterWakeUp"]),
		StagesMinutes:        mapStageMinutes(summary),
		StartTime:            strField(interval, "startTime"),
		EndTime:              strField(interval, "endTime"),
		DataPointName:        dataPointName(m),
	}
	if score, ok := lookupSleepScore(summary, sleep); ok {
		res.SleepScore = &score
	}
	return res, true
}

func mapSleepSessions(points []map[string]any) []SleepResult {
	out := make([]SleepResult, 0, len(points))
	for _, p := range points {
		session, ok := mapSleep(p)
		if !ok {
			continue
		}
		out = append(out, session)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Date != out[j].Date {
			return out[i].Date < out[j].Date
		}
		return out[i].EndTime < out[j].EndTime
	})
	return out
}

func sessionWakeDay(interval map[string]any) string {
	if civil := asMap(interval["civilEndTime"]); civil != nil {
		if d := formatAPIDate(asMap(civil["date"])); d != "" {
			return d
		}
	}
	if end := strField(interval, "endTime"); end != "" {
		if t, err := time.Parse(time.RFC3339, end); err == nil {
			return t.In(time.Local).Format("2006-01-02")
		}
	}
	return ""
}

func isMainSleep(meta map[string]any) bool {
	return boolField(meta, "mainSleep") || boolField(meta, "main")
}

func boolField(m map[string]any, key string) bool {
	if m == nil {
		return false
	}
	b, ok := m[key].(bool)
	return ok && b
}

func lookupSleepScore(objs ...map[string]any) (float64, bool) {
	for _, m := range objs {
		if m == nil {
			continue
		}
		for _, key := range sleepScoreKeys {
			if f, ok := parseFloatishPresent(m[key]); ok {
				return f, true
			}
		}
	}
	return 0, false
}

func mapStageMinutes(summary map[string]any) map[string]float64 {
	raw, ok := summary["stagesSummary"].([]any)
	if !ok || len(raw) == 0 {
		return nil
	}
	out := make(map[string]float64, len(raw))
	for _, item := range raw {
		stage := asMap(item)
		typ := strings.ToLower(strField(stage, "type"))
		if typ == "" {
			continue
		}
		out[typ] = parseFloatish(stage["minutes"])
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func mapExercise(m map[string]any) Activity {
	ex := asMap(m["exercise"])
	interval := asMap(ex["interval"])
	metrics := asMap(ex["metricsSummary"])
	name := dataPointName(m)
	id := name
	if id != "" {
		id = path.Base(id)
	}
	activeDur := parseDurationSeconds(strField(ex, "activeDuration"))
	durationMin := activeDur / 60
	if durationMin == 0 {
		start := strField(interval, "startTime")
		end := strField(interval, "endTime")
		if st, err1 := time.Parse(time.RFC3339, start); err1 == nil {
			if et, err2 := time.Parse(time.RFC3339, end); err2 == nil {
				durationMin = et.Sub(st).Minutes()
			}
		}
	}
	distMM := parseFloatish(metrics["distanceMillimeters"])
	return Activity{
		ID:           firstNonEmpty(name, id),
		Name:         strField(ex, "displayName"),
		ActivityType: strField(ex, "exerciseType"),
		StartTime:    strField(interval, "startTime"),
		DurationMin:  durationMin,
		Calories:     parseFloatish(metrics["caloriesKcal"]),
		Steps:        parseFloatish(metrics["steps"]),
		DistanceKM:   distMM / 1_000_000,
	}
}

func mapRestingHRList(points []map[string]any, truncated bool) *HeartRateListResult {
	entries := make([]HeartRateResult, 0, len(points))
	for _, m := range points {
		dr := asMap(m["dailyRestingHeartRate"])
		if dr == nil {
			continue
		}
		entries = append(entries, HeartRateResult{
			Date:      formatAPIDate(asMap(dr["date"])),
			RestingHR: parseFloatish(dr["beatsPerMinute"]),
		})
	}
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].Date < entries[j].Date })
	note := "daily-resting-heart-rate via reconcile"
	if len(entries) == 0 {
		note = "no daily resting heart rate in range"
	}
	if truncated {
		note = "truncated; narrow after_date/before_date. " + note
	}
	return &HeartRateListResult{Entries: entries, Count: len(entries), Note: note}
}

func mapHRVList(points []map[string]any, truncated bool) *HRVListResult {
	entries := make([]HRVResult, 0, len(points))
	for _, m := range points {
		h := asMap(m["dailyHeartRateVariability"])
		if h == nil {
			continue
		}
		rmssd := parseFloatish(h["averageHeartRateVariabilityMilliseconds"])
		if rmssd == 0 {
			rmssd = parseFloatish(h["deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds"])
		}
		entries = append(entries, HRVResult{
			Date:  formatAPIDate(asMap(h["date"])),
			RMSSD: rmssd,
		})
	}
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].Date < entries[j].Date })
	note := "daily-heart-rate-variability via reconcile"
	if len(entries) == 0 {
		note = "no daily HRV in range"
	}
	if truncated {
		note = "truncated; narrow after_date/before_date. " + note
	}
	return &HRVListResult{Entries: entries, Count: len(entries), Note: note}
}

func mapWeightEntries(points []map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(points))
	for _, p := range points {
		w := asMap(p["weight"])
		grams := parseFloatish(w["weightGrams"])
		sample := asMap(w["sampleTime"])
		entry := map[string]any{
			"data_point_name": dataPointName(p),
			"weight_kg":       grams / 1000,
			"weight_grams":    grams,
			"physical_time":   strField(sample, "physicalTime"),
			"notes":           strField(w, "notes"),
		}
		if civil := asMap(sample["civilTime"]); civil != nil {
			if d := asMap(civil["date"]); d != nil {
				entry["date"] = formatAPIDate(d)
			}
		}
		out = append(out, entry)
	}
	return out
}

func formatAPIDate(d map[string]any) string {
	y := int(parseFloatish(d["year"]))
	m := int(parseFloatish(d["month"]))
	day := int(parseFloatish(d["day"]))
	if y == 0 || m == 0 || day == 0 {
		return ""
	}
	return CivilDate{Year: y, Month: time.Month(m), Day: day}.String()
}

func strField(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key].(string)
	if !ok {
		return ""
	}
	return v
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
