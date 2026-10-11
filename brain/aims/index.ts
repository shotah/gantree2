/**
 * Ledger of events scored against live `aim/<area>` rows, and the `aims`
 * frame the phone board renders. Ported from `harness/internal/aims`.
 */
export { AimsError } from "./error";
export { type AimMemory, type AimNote } from "./memory";
export { AIM_MIGRATIONS } from "./schema";
export {
  SCORE_MAX,
  SCORE_MIN,
  type AimEvent,
  type AimScore,
  type AimStats,
  type BlockSpan,
  type DayScore,
  type LogInput,
  type Series,
} from "./types";
export { effect, pearson, stampCorr, weekSlope } from "./math";
export { RUBRIC_TEXT } from "./rubric";
export { formatLine, progress, suffix } from "./text";
export { AimStore, aimsFrame, openAims } from "./store";
export { AIM_HISTORY, AIM_LOG, aimToolDefs, aimTools, callAim, isAimTool } from "./tools";
