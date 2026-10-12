/** Lowest agent opinion of an event. */
export const SCORE_MIN = -3;
/** Highest agent opinion of an event. */
export const SCORE_MAX = 3;
/** Source stamped when the caller does not name one. */
export const SOURCE_DEFAULT = "model";

/** The agent's opinion of one event toward one aim. */
export type AimScore = {
  area: string;
  value: number;
  note: string;
};

/** One thing that happened, scored against every aim it touches. */
export type AimEvent = {
  id: number;
  /** Local `YYYY-MM-DD`. */
  day: string;
  what: string;
  ref: string;
  metric: string;
  /** Null when the row has no measurement. */
  value: number | null;
  unit: string;
  source: string;
  /** ms epoch. `0` when `created_at` did not parse. */
  createdAt: number;
  supersededBy: number | null;
  scores: AimScore[];
};

/**
 * Fields for {@link AimStore.log}. Blank strings copy from the row being
 * rewritten. `value` absent means "not provided"; `null` with a metric clears it.
 */
export type LogInput = {
  /** Rewrite this live event. Wins over `ref`. */
  id?: number;
  day?: string;
  what?: string;
  ref?: string;
  metric?: string;
  value?: number | null;
  unit?: string;
  source?: string;
  /** Applied to every score written by this call. Blank keeps the previous note. */
  note?: string;
};

/** A dated span stored in `aim_block`. Adherence math is {@link AimBlock} on the wire. */
export type BlockSpan = {
  area: string;
  fromDay: string;
  toDay: string;
};

/** One local calendar day. A missing day is score 0 and `events: []`. */
export type DayScore = {
  day: string;
  score: number;
  events: AimEvent[];
};

/**
 * Windows ending on a local day. `rating30` and `mean7` count missing days
 * as 0. `streak` is consecutive days scored above 0. An empty today stays
 * out of the run; a day scored at or below 0 ends it.
 */
export type AimStats = {
  sum7: number;
  sum14: number;
  up7: number;
  against7: number;
  streak: number;
  rating30: number;
  mean7: number;
  lastNote: string;
  /** ms epoch; `0` when there is no note. */
  lastNoteAt: number;
  hasEvents: boolean;
};

/** One measurement under an aim, in the unit it was logged. Slope is per calendar day. */
export type Series = {
  metric: string;
  unit: string;
  latest: number;
  mean: number;
  slope: number;
  n: number;
  ok: boolean;
};
