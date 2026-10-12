/** Job kinds stored on `cron_job.kind`. */
export const KindOnce = "once";
export const KindDaily = "daily";
export const KindEvery = "every";
export const KindDailyPlanner = "daily_planner";
export const KindExamples = "examples";
export const KindExamplesPing = "examples_ping";
export const KindFollowUp = "followup";

export const ToolSchedule = "cron_schedule";
export const ToolList = "cron_list";
export const ToolCancel = "cron_cancel";

export const SilentToken = "[silent]";
export const WaitToken = "[wait]";
export const NoWaitToken = "[nowait]";
export const ReactPrefix = "[react ";

/** Two pokes after the original question. */
export const MaxWaitNudges = 2;

/** Pause before nudge 1 and nudge 2, measured from the previous send. */
export const FollowUpDelaysMs = [2 * 60_000, 15 * 60_000];

export const DefaultPlannerAt = "07:10";
export const PlannerOff = "0";

/** `pref/hours` preference row. Example pings defer while this window says asleep. */
export const SubjectHours = "pref/hours";
export const KindPreference = "preference";

/**
 * How long a recent human message suppresses an examples ping when the runner
 * option is unset. `docs/cron.md` and `EXAMPLES_SKIP_RECENT_MINUTES` default
 * to 60. The Go runner's zero-value fallback is 30 minutes; the shipped env
 * default is what the Durable Object should pass.
 */
export const DefaultExamplesSkipRecentMs = 60 * 60_000;

/** Due-query batch. The alarm fires at `nextDue`, not on a 15s poll. */
export const DueBatch = 5;
