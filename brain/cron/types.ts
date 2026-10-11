/**
 * Callbacks the cron runner needs from packages that are not written yet
 * (agent loop, session, memory). Nothing here imports those packages.
 */

export type Delivery = {
  sessionId: string;
  userId?: string;
  chatId?: string;
  threadId?: number;
};

/** Normalized schedule. `nextRun` and other instants are epoch ms. */
export type Parsed = {
  kind: string;
  /** once: RFC3339; daily: HH:MM; every: Go duration string; spread: qty@HH-HH. */
  expr: string;
  nextRun: number;
  timezone: string;
};

export type Job = {
  id: number;
  prompt: string;
  kind: string;
  expr: string;
  timezone: string;
  nextRunAt: number;
  sessionId: string;
  userId: string;
  chatId: string;
  threadId: number;
  enabled: boolean;
  running: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  lastError: string;
  memoryId: number;
  memorySubject: string;
};

/** One turn the runner asks the agent loop to run. */
export type JobTurn = {
  sessionId: string;
  text: string;
  /** Examples pings propose only — the loop must omit tools. */
  noTools: boolean;
  /** Handler appends MCP image URLs; they ride the push. */
  photos: string[];
};

export type JobHandler = (turn: JobTurn) => Promise<string> | string;

export type PushMessage = {
  text: string;
  photos: string[];
  /** Mailbox frame id, `cron-<job>-<ms>`. */
  id: string;
};

export type Pusher = (msg: PushMessage) => Promise<void> | void;

export type FireOutcomeName = "push" | "silent" | "error" | "defer" | "drop" | "skip" | "seed";

export type FireOutcome = {
  id: number;
  kind: string;
  outcome: FireOutcomeName;
  frameId?: string;
};

/** Barge-in guard for examples pings. True when the human messaged at or after `sinceMs`. */
export type RecentUserActivity = (sessionId: string, sinceMs: number) => Promise<boolean> | boolean;

/** Live inventory-aware body for an examples ping, built at fire time. */
export type ExamplePromptBuilder = () => Promise<string> | string;

export type MemoryPin = {
  id: number;
  kind: string;
  subject: string;
  content: string;
  /** Live row that replaced this one. Null when this row is current. */
  supersededBy: number | null;
};

export type MemoryLookup = {
  get(id: number): Promise<MemoryPin | null> | MemoryPin | null;
  activeByKindSubject(kind: string, subject: string): Promise<MemoryPin | null> | MemoryPin | null;
};

export type TalkState = {
  lastSpeaker: string;
  waitingForReply: boolean;
  waitNudges: number;
  waitSetAt: number | null;
};

export type TalkStore = {
  talkState(sessionId: string): Promise<TalkState> | TalkState;
  armWait(sessionId: string): Promise<void> | void;
  clearWait(sessionId: string): Promise<void> | void;
  bumpWaitNudge(sessionId: string): Promise<TalkState> | TalkState;
};
