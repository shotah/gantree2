import { anyShape, arr, bool, int, mapOf, matrixAny, matrixInt, num, obj, ptr, ptrObj, str, strs, ints, anys, type Shape } from "./json";

const grade = obj([
  ["sortOrder", int],
  ["valueKey", str],
  ["scale", str],
]);

const sleepDto = obj([
  ["id", ptr],
  ["calendarDate", str],
  ["sleepStartTimestampGMT", int],
  ["sleepEndTimestampGMT", int],
  ["sleepTimeSeconds", int],
  ["deepSleepSeconds", ptr],
  ["lightSleepSeconds", ptr],
  ["remSleepSeconds", ptr],
  ["awakeSleepSeconds", ptr],
  ["averageSpO2Value", ptr],
  ["awakeCount", ptr],
  ["avgSleepStress", ptr],
]);

export const dailySleepShape: Shape = obj([
  ["dailySleepDTO", sleepDto],
  ["remSleepData", bool],
  ["bodyBatteryChange", ptr],
]);

const hrvBaseline = obj([
  ["lowUpper", int],
  ["balancedLow", int],
  ["balancedUpper", int],
  ["markerValue", num],
]);

const hrvSummary = obj([
  ["calendarDate", str],
  ["weeklyAvg", int],
  ["lastNightAvg", int],
  ["lastNight5MinHigh", int],
  ["baseline", hrvBaseline],
  ["status", str],
  ["feedbackPhrase", str],
  ["createTimeStamp", str],
]);

const hrvReading = obj([
  ["hrvValue", int],
  ["readingTimeGMT", str],
  ["readingTimeLocal", str],
]);

export const dailyHrvShape: Shape = obj([
  ["userProfilePk", int],
  ["hrvSummary", hrvSummary],
  ["hrvReadings", arr(hrvReading)],
  ["startTimestampGMT", str],
  ["endTimestampGMT", str],
  ["startTimestampLocal", str],
  ["endTimestampLocal", str],
  ["sleepStartTimestampGMT", str],
  ["sleepEndTimestampGMT", str],
  ["sleepStartTimestampLocal", str],
  ["sleepEndTimestampLocal", str],
]);

const weightEntry = obj([
  ["samplePk", ptr],
  ["date", ptr],
  ["calendarDate", str],
  ["weight", ptr],
  ["bmi", ptr],
  ["bodyFat", ptr],
  ["bodyWater", ptr],
  ["boneMass", ptr],
  ["muscleMass", ptr],
  ["physiqueRating", ptr],
  ["visceralFat", ptr],
  ["metabolicAge", ptr],
  ["sourceType", ptr],
  ["timestampGMT", ptr],
  ["weightDelta", ptr],
]);

const weightAverage = obj([
  ["from", int],
  ["until", int],
  ["weight", ptr],
  ["bmi", ptr],
  ["bodyFat", ptr],
  ["bodyWater", ptr],
  ["boneMass", ptr],
  ["muscleMass", ptr],
  ["physiqueRating", ptr],
  ["visceralFat", ptr],
  ["metabolicAge", ptr],
]);

export const dailyWeightShape: Shape = obj([
  ["startDate", str],
  ["endDate", str],
  ["dateWeightList", arr(weightEntry)],
  ["totalAverage", weightAverage],
]);

export const dailySummaryShape: Shape = obj([
  ["userProfileId", int],
  ["userDailySummaryId", int],
  ["calendarDate", str],
  ["uuid", str],
  ["totalKilocalories", num],
  ["activeKilocalories", num],
  ["bmrKilocalories", num],
  ["wellnessKilocalories", num],
  ["burnedKilocalories", ptr],
  ["consumedKilocalories", ptr],
  ["remainingKilocalories", num],
  ["netCalorieGoal", ptr],
  ["totalSteps", int],
  ["dailyStepGoal", int],
  ["totalDistanceMeters", num],
  ["wellnessDistanceMeters", num],
  ["wellnessActiveKilocalories", num],
  ["netRemainingKilocalories", num],
  ["highlyActiveSeconds", int],
  ["activeSeconds", int],
  ["sedentarySeconds", int],
  ["sleepingSeconds", int],
  ["floorsAscended", num],
  ["floorsDescended", num],
  ["floorsAscendedInMeters", num],
  ["floorsDescendedInMeters", num],
  ["userFloorsAscendedGoal", int],
  ["intensityMinutesGoal", int],
  ["moderateIntensityMinutes", ptr],
  ["vigorousIntensityMinutes", ptr],
  ["minHeartRate", int],
  ["maxHeartRate", int],
  ["restingHeartRate", ptr],
  ["lastSevenDaysAvgRestingHeartRate", ptr],
  ["averageStressLevel", int],
  ["maxStressLevel", int],
  ["stressQualifier", str],
  ["bodyBatteryChargedValue", int],
  ["bodyBatteryDrainedValue", int],
  ["bodyBatteryHighestValue", int],
  ["bodyBatteryLowestValue", int],
  ["bodyBatteryMostRecentValue", int],
  ["includesWellnessData", bool],
  ["includesActivityData", bool],
  ["privacyProtected", bool],
]);

const batteryEventBody = obj([
  ["eventType", str],
  ["eventStartTimeGmt", str],
  ["timezoneOffset", int],
  ["durationInMilliseconds", int],
  ["bodyBatteryImpact", int],
  ["feedbackType", str],
  ["shortFeedback", str],
]);

export const bodyBatteryEventShape: Shape = obj([
  ["event", ptrObj(batteryEventBody)],
  ["activityName", ptr],
  ["activityType", ptr],
  ["activityId", anyShape],
  ["averageStress", ptr],
  ["stressValuesArray", matrixInt],
  ["bodyBatteryValuesArray", matrixAny],
]);

export const readinessEntryShape: Shape = obj([
  ["userProfilePK", int],
  ["calendarDate", str],
  ["timestamp", str],
  ["timestampLocal", str],
  ["deviceId", int],
  ["level", str],
  ["feedbackLong", str],
  ["feedbackShort", str],
  ["score", int],
  ["sleepScore", ptr],
  ["sleepScoreFactorPercent", int],
  ["sleepScoreFactorFeedback", str],
  ["recoveryTime", int],
  ["recoveryTimeFactorPercent", int],
  ["recoveryTimeFactorFeedback", str],
  ["acwrFactorPercent", int],
  ["acwrFactorFeedback", str],
  ["acuteLoad", int],
  ["stressHistoryFactorPercent", int],
  ["stressHistoryFactorFeedback", str],
  ["hrvFactorPercent", int],
  ["hrvFactorFeedback", str],
  ["hrvWeeklyAverage", int],
  ["sleepHistoryFactorPercent", int],
  ["sleepHistoryFactorFeedback", str],
  ["validSleep", bool],
  ["inputContext", str],
  ["primaryActivityTracker", bool],
  ["recoveryTimeChangePhrase", ptr],
  ["sleepHistoryFactorFeedbackPhrase", ptr],
  ["hrvFactorFeedbackPhrase", ptr],
  ["stressHistoryFactorFeedbackPhrase", ptr],
  ["acwrFactorFeedbackPhrase", ptr],
  ["recoveryTimeFactorFeedbackPhrase", ptr],
  ["sleepScoreFactorFeedbackPhrase", ptr],
]);

const activityType = obj([
  ["typeId", int],
  ["typeKey", str],
  ["parentTypeId", int],
  ["isHidden", bool],
  ["restricted", bool],
  ["trimmable", bool],
]);

const eventType = obj([
  ["typeId", int],
  ["typeKey", str],
  ["sortOrder", int],
]);

const fileFormat = obj([
  ["formatId", int],
  ["formatKey", str],
]);

const userInfo = obj([
  ["userProfilePk", int],
  ["displayname", str],
  ["fullname", str],
  ["profileImageUrlLarge", str],
  ["profileImageUrlMedium", str],
  ["profileImageUrlSmall", str],
  ["userPro", bool],
]);

const sensor = obj([
  ["manufacturer", str],
  ["serialNumber", int],
  ["sourceType", str],
  ["antplusDeviceType", str],
  ["softwareVersion", num],
  ["batteryStatus", str],
  ["batteryLevel", int],
]);

const deviceMeta = obj([
  ["deviceId", str],
  ["deviceTypePk", int],
  ["deviceVersionPk", int],
]);

const metadata = obj([
  ["isOriginal", bool],
  ["deviceApplicationInstallationId", int],
  ["agentApplicationInstallationId", ptr],
  ["agentString", ptr],
  ["fileFormat", fileFormat],
  ["associatedCourseId", ptr],
  ["lastUpdateDate", str],
  ["uploadedDate", str],
  ["videoUrl", ptr],
  ["hasPolyline", bool],
  ["hasChartData", bool],
  ["hasHrTimeInZones", bool],
  ["hasPowerTimeInZones", bool],
  ["userInfoDto", userInfo],
  ["childIds", ints],
  ["childActivityTypes", arr(activityType)],
  ["sensors", arr(sensor)],
  ["activityImages", anys],
  ["manufacturer", str],
  ["diveNumber", ptr],
  ["lapCount", int],
  ["associatedWorkoutId", ptr],
  ["isAtpActivity", ptr],
  ["deviceMetaDataDTO", deviceMeta],
  ["hasIntensityIntervals", bool],
  ["hasSplits", bool],
  ["eBikeMaxAssistModes", ptr],
  ["eBikeBatteryUsage", ptr],
  ["eBikeBatteryRemaining", ptr],
  ["eBikeAssistModeInfoDTOList", anys],
  ["hasRunPowerWindData", bool],
  ["calendarEventInfo", anyShape],
  ["groupRideUUID", ptr],
  ["hasHeatMap", bool],
  ["specializedWorkoutCategories", strs],
  ["trainingPlanId", ptr],
  ["personalRecord", bool],
  ["gcj02", bool],
  ["runPowerWindDataEnabled", bool],
  ["elevationCorrected", bool],
  ["trimmed", bool],
  ["manualActivity", bool],
  ["autoCalcCalories", bool],
  ["favorite", bool],
]);

const summary = obj([
  ["startTimeLocal", str],
  ["startTimeGMT", str],
  ["startLatitude", num],
  ["startLongitude", num],
  ["endLatitude", num],
  ["endLongitude", num],
  ["distance", num],
  ["duration", num],
  ["movingDuration", num],
  ["elapsedDuration", num],
  ["elevationGain", num],
  ["elevationLoss", num],
  ["maxElevation", num],
  ["minElevation", num],
  ["averageSpeed", num],
  ["averageMovingSpeed", num],
  ["maxSpeed", num],
  ["maxVerticalSpeed", num],
  ["calories", num],
  ["bmrCalories", num],
  ["averageHR", num],
  ["maxHR", num],
  ["minHR", num],
  ["averageRunCadence", num],
  ["maxRunCadence", num],
  ["averagePower", num],
  ["maxPower", num],
  ["minPower", num],
  ["normalizedPower", num],
  ["totalWork", num],
  ["groundContactTime", num],
  ["strideLength", num],
  ["verticalOscillation", num],
  ["verticalRatio", num],
  ["trainingEffect", num],
  ["anaerobicTrainingEffect", num],
  ["aerobicTrainingEffectMessage", str],
  ["anaerobicTrainingEffectMessage", str],
  ["trainingEffectLabel", str],
  ["activityTrainingLoad", num],
  ["waterEstimated", num],
  ["minRespirationRate", num],
  ["maxRespirationRate", num],
  ["avgRespirationRate", num],
  ["minActivityLapDuration", num],
  ["directWorkoutFeel", int],
  ["directWorkoutRpe", int],
  ["directWorkoutComplianceScore", int],
  ["moderateIntensityMinutes", int],
  ["vigorousIntensityMinutes", int],
  ["steps", int],
  ["beginPotentialStamina", num],
  ["endPotentialStamina", num],
  ["minAvailableStamina", num],
  ["avgGradeAdjustedSpeed", num],
  ["differenceBodyBattery", int],
]);

const splitSummary = obj([
  ["noOfSplits", int],
  ["totalAscent", num],
  ["duration", num],
  ["splitType", str],
  ["numClimbSends", int],
  ["maxElevationGain", num],
  ["averageElevationGain", num],
  ["maxDistance", int],
  ["distance", num],
  ["averageSpeed", num],
  ["maxSpeed", num],
  ["numFalls", int],
  ["elevationLoss", num],
  ["numClimbsCompleted", int, "omit"],
  ["mode", str, "omit"],
  ["maxGradeValue", ptrObj(grade), "omit"],
  ["movingDuration", ptr, "omit"],
  ["elevationGain", ptr, "omit"],
  ["averageMovingSpeed", ptr, "omit"],
  ["calories", ptr, "omit"],
  ["bmrCalories", ptr, "omit"],
  ["averageHR", ptr, "omit"],
  ["maxHR", ptr, "omit"],
  ["averageRunCadence", ptr, "omit"],
  ["maxRunCadence", ptr, "omit"],
  ["averagePower", ptr, "omit"],
  ["maxPower", ptr, "omit"],
  ["normalizedPower", ptr, "omit"],
  ["groundContactTime", ptr, "omit"],
  ["strideLength", ptr, "omit"],
  ["verticalOscillation", ptr, "omit"],
  ["verticalRatio", ptr, "omit"],
  ["totalExerciseReps", ptr, "omit"],
  ["avgVerticalSpeed", ptr, "omit"],
  ["avgGradeAdjustedSpeed", ptr, "omit"],
  ["maxDistanceWithPrecision", ptr, "omit"],
  ["avgStepFrequency", ptr, "omit"],
  ["avgStepLength", ptr, "omit"],
]);

const uuid = obj([["uuid", str]]);

const access = obj([
  ["typeId", int],
  ["typeKey", str],
]);

const zone = obj([
  ["unitId", int],
  ["unitKey", str],
  ["factor", num],
  ["timeZone", str],
]);

export const activityDetailShape: Shape = obj([
  ["activityId", int],
  ["activityUUID", uuid],
  ["activityName", str],
  ["userProfileId", int],
  ["isMultiSportParent", bool],
  ["activityTypeDTO", activityType],
  ["eventTypeDTO", eventType],
  ["accessControlRuleDTO", access],
  ["timeZoneUnitDTO", zone],
  ["metadataDTO", metadata],
  ["summaryDTO", summary],
  ["locationName", str],
  ["splitSummaries", arr(splitSummary)],
]);

export const typedSplitShape: Shape = obj([
  ["startTimeLocal", str],
  ["startTimeGMT", str],
  ["endTimeGMT", str],
  ["startLatitude", num],
  ["startLongitude", num],
  ["endLatitude", num],
  ["endLongitude", num],
  ["distance", num],
  ["duration", num],
  ["movingDuration", num],
  ["elapsedDuration", num],
  ["elevationGain", num],
  ["elevationLoss", num],
  ["startElevation", num],
  ["averageSpeed", num],
  ["averageMovingSpeed", num],
  ["maxSpeed", num],
  ["calories", num],
  ["bmrCalories", num],
  ["averageHR", num],
  ["maxHR", num],
  ["averageRunCadence", num],
  ["maxRunCadence", num],
  ["averagePower", num],
  ["maxPower", num],
  ["normalizedPower", num, "omit"],
  ["groundContactTime", num, "omit"],
  ["strideLength", num],
  ["verticalOscillation", num],
  ["verticalRatio", num],
  ["totalExerciseReps", int],
  ["avgVerticalSpeed", num],
  ["avgGradeAdjustedSpeed", num],
  ["avgElapsedDurationVerticalSpeed", num],
  ["avgStepLength", num],
  ["type", str],
  ["messageIndex", int],
  ["lapIndexes", ints, "omit"],
  ["status", str, "omit"],
  ["gradeValue", ptrObj(grade), "omit"],
]);

export const typedSplitsShape: Shape = obj([
  ["activityId", int],
  ["activityUUID", uuid],
  ["splits", arr(typedSplitShape)],
]);

const splitDetail = obj([
  ["distance", num],
  ["duration", num],
  ["movingDuration", num],
  ["elevationGain", num],
  ["elevationLoss", num],
  ["averageSpeed", num],
  ["averageMovingSpeed", num],
  ["maxSpeed", num],
  ["calories", num],
  ["bmrCalories", num],
  ["averageHR", num],
  ["maxHR", num],
  ["averageRunCadence", num],
  ["maxRunCadence", num],
  ["averagePower", num],
  ["maxPower", num],
  ["normalizedPower", num, "omit"],
  ["groundContactTime", num, "omit"],
  ["strideLength", num],
  ["verticalOscillation", num],
  ["verticalRatio", num],
  ["totalExerciseReps", int],
  ["avgVerticalSpeed", num],
  ["avgGradeAdjustedSpeed", num],
  ["splitType", str],
  ["noOfSplits", int],
  ["numFalls", int, "omit"],
  ["numClimbSends", int, "omit"],
  ["numClimbsCompleted", int, "omit"],
  ["mode", str, "omit"],
  ["maxGradeValue", ptrObj(grade), "omit"],
  ["maxElevationGain", num],
  ["averageElevationGain", num],
  ["maxDistance", int],
  ["maxDistanceWithPrecision", num],
  ["avgStepFrequency", num],
  ["avgStepLength", num],
]);

export const splitSummariesShape: Shape = obj([
  ["activityId", int],
  ["activityUUID", uuid],
  ["splitSummaries", arr(splitDetail)],
]);

export const dailyStressShape: Shape = obj([
  ["calendarDate", str],
  ["maxStressLevel", int],
  ["avgStressLevel", int],
  ["stressChartValueOffset", int],
  ["stressChartYAxisOrigin", int],
  ["stressValuesArray", matrixInt],
  ["bodyBatteryValuesArray", matrixAny],
]);

const hrDescriptor = obj([
  ["key", str],
  ["index", int],
]);

export const dailyHeartRateShape: Shape = obj([
  ["userProfilePK", int],
  ["calendarDate", str],
  ["startTimestampGMT", str],
  ["endTimestampGMT", str],
  ["startTimestampLocal", str],
  ["endTimestampLocal", str],
  ["maxHeartRate", int],
  ["minHeartRate", int],
  ["restingHeartRate", int],
  ["lastSevenDaysAvgRestingHeartRate", int],
  ["heartRateValueDescriptors", arr(hrDescriptor)],
  ["heartRateValues", matrixInt],
]);

const imDescriptor = obj([
  ["index", int],
  ["key", str],
]);

export const dailyIntensityShape: Shape = obj([
  ["userProfilePK", int],
  ["calendarDate", str],
  ["startTimestampGMT", str],
  ["endTimestampGMT", str],
  ["startTimestampLocal", str],
  ["endTimestampLocal", str],
  ["weeklyModerate", int],
  ["weeklyVigorous", int],
  ["weeklyTotal", int],
  ["weekGoal", int],
  ["dayOfGoalMet", ptr],
  ["startDayMinutes", int],
  ["endDayMinutes", int],
  ["moderateMinutes", int],
  ["vigorousMinutes", int],
  ["imValueDescriptorsDTOList", arr(imDescriptor)],
  ["imValuesArray", matrixInt],
]);

export const bodyBatteryReportShape: Shape = obj([
  ["date", str],
  ["charged", int],
  ["drained", int],
  ["bodyBatteryValuesArray", matrixAny],
]);

export const sleepScoreEntryShape: Shape = obj([
  ["calendarDate", str],
  ["value", int],
  ["qualifierKey", str],
]);

const vo2Generic = obj([
  ["calendarDate", str],
  ["vo2MaxPreciseValue", num],
  ["vo2MaxValue", num],
  ["fitnessAge", ptr],
  ["fitnessAgeDescription", ptr],
  ["maxMetCategory", int],
]);

const heatAltitude = obj([
  ["calendarDate", str],
  ["altitudeAcclimationDate", str],
  ["previousAltitudeAcclimationDate", str],
  ["heatAcclimationDate", str],
  ["previousHeatAcclimationDate", str],
  ["altitudeAcclimation", int],
  ["previousAltitudeAcclimation", int],
  ["heatAcclimationPercentage", int],
  ["previousHeatAcclimationPercentage", int],
  ["heatTrend", str],
  ["altitudeTrend", ptr],
  ["currentAltitude", int],
  ["previousAltitude", int],
  ["acclimationPercentage", int],
  ["previousAcclimationPercentage", int],
  ["altitudeAcclimationLocalTimestamp", str],
]);

export const maxMetShape: Shape = obj([
  ["userId", int],
  ["generic", ptrObj(vo2Generic)],
  ["cycling", ptrObj(vo2Generic)],
  ["heatAltitudeAcclimation", ptrObj(heatAltitude)],
]);

const acuteLoad = obj([
  ["acwrPercent", int],
  ["acwrStatus", str],
  ["acwrStatusFeedback", str],
  ["dailyTrainingLoadAcute", int],
  ["maxTrainingLoadChronic", num],
  ["minTrainingLoadChronic", num],
  ["dailyTrainingLoadChronic", int],
  ["dailyAcuteChronicWorkloadRatio", num],
]);

const trainingStatusData = obj([
  ["calendarDate", str],
  ["sinceDate", str],
  ["weeklyTrainingLoad", ptr],
  ["trainingStatus", int],
  ["timestamp", int],
  ["deviceId", int],
  ["loadTunnelMin", ptr],
  ["loadTunnelMax", ptr],
  ["loadLevelTrend", ptr],
  ["sport", ptr],
  ["subSport", ptr],
  ["fitnessTrendSport", str],
  ["fitnessTrend", int],
  ["trainingStatusFeedbackPhrase", str],
  ["trainingPaused", bool],
  ["acuteTrainingLoadDTO", ptrObj(acuteLoad)],
  ["primaryTrainingDevice", bool],
]);

const recordedDevice = obj([
  ["deviceId", int],
  ["imageURL", str],
  ["deviceName", str],
  ["category", int],
]);

const trainingStatusDaily = obj([
  ["userId", int],
  ["latestTrainingStatusData", mapOf(ptrObj(trainingStatusData))],
  ["recordedDevices", arr(recordedDevice)],
  ["showSelector", bool],
  ["lastPrimarySyncDate", str],
]);

const loadBalanceData = obj([
  ["calendarDate", str],
  ["deviceId", int],
  ["monthlyLoadAerobicLow", num],
  ["monthlyLoadAerobicHigh", num],
  ["monthlyLoadAnaerobic", num],
  ["monthlyLoadAerobicLowTargetMin", int],
  ["monthlyLoadAerobicLowTargetMax", int],
  ["monthlyLoadAerobicHighTargetMin", int],
  ["monthlyLoadAerobicHighTargetMax", int],
  ["monthlyLoadAnaerobicTargetMin", int],
  ["monthlyLoadAnaerobicTargetMax", int],
  ["trainingBalanceFeedbackPhrase", str],
  ["primaryTrainingDevice", bool],
]);

const trainingLoadBalance = obj([
  ["userId", int],
  ["metricsTrainingLoadBalanceDTOMap", mapOf(ptrObj(loadBalanceData))],
  ["recordedDevices", arr(recordedDevice)],
]);

export const trainingStatusAggregatedShape: Shape = obj([
  ["userId", int],
  ["mostRecentVO2Max", ptrObj(maxMetShape)],
  ["mostRecentTrainingLoadBalance", ptrObj(trainingLoadBalance)],
  ["mostRecentTrainingStatus", ptrObj(trainingStatusDaily)],
  ["heatAltitudeAcclimationDTO", ptrObj(heatAltitude)],
]);

const metricUnit = obj([
  ["id", int],
  ["key", str],
  ["factor", num],
]);

const metricDescriptor = obj([
  ["metricsIndex", int],
  ["key", str],
  ["unit", metricUnit],
]);

export const activityDetailsShape: Shape = obj([
  ["activityId", int],
  ["measurementCount", int],
  ["metricsCount", int],
  ["totalMetricsCount", int],
  ["metricDescriptors", arr(metricDescriptor)],
  ["activityDetailMetrics", arr(obj([["metrics", anys]]))],
]);
