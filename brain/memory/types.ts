/**
 * Structured long-term memory. Kinds, subjects, and row shape match the
 * harness `memory` table so a copied `gantry.db` stays readable.
 */

export const KIND_FACT = "fact";
export const KIND_PREFERENCE = "preference";
export const KIND_PERSON = "person";
export const KIND_EPISODE = "episode";
export const KIND_INSIGHT = "insight";

export const SOURCE_CHAT = "chat";
export const SOURCE_CONSOLIDATION = "consolidation";
export const SOURCE_OPERATOR = "operator";

/** Sleep / work / quiet windows. */
export const SUBJECT_HOURS = "pref/hours";
export const SUBJECT_AIM_PREFIX = "aim/";
export const SUBJECT_WAITING_PREFIX = "waiting/";
export const SUBJECT_FOLLOW_PREFIX = "follow/";
/** The human's pocket list. Nothing on it ages out. */
export const SUBJECT_TODO_PREFIX = "todo/";
/** Fact the model writes after asking the months-scale question once. */
export const SUBJECT_AIM_BOOTSTRAP = "aim/bootstrap";

export const DEFAULT_RECALL_LIMIT = 20;
export const DEFAULT_HYDRATE_LIMIT = 30;
/** `ListBySubjectPrefix` window when the caller passes no positive limit. */
export const HORIZON_FETCH = 30;
export const EPISODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const MAX_CONSOLIDATE_ATTEMPTS = 3;
export const CONSOLIDATED_DONE = 1;
export const CONSOLIDATED_QUARANTINE = 2;

const KIND_SET = new Set<string>([
  KIND_FACT,
  KIND_PREFERENCE,
  KIND_PERSON,
  KIND_EPISODE,
  KIND_INSIGHT,
]);

/** One structured memory row. Times are ms since epoch; `0` means unset. */
export type Entry = {
  id: number;
  kind: string;
  subject: string;
  content: string;
  source: string;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  supersededBy: number | null;
};

/** One extracted durable row from a consolidation pass. */
export type ConsolidateItem = {
  kind: string;
  subject: string;
  content: string;
  supersedes: number[];
};

/** `/memstats` view of the builtin store. */
export type StatsSnapshot = {
  total: number;
  byKind: Record<string, number>;
  active: number;
  expired: number;
  superseded: number;
  /** Unconsolidated episodes still eligible. */
  backlog: number;
  /** Episodes past the consolidate attempt limit. */
  quarantined: number;
  dbBytes: number;
};

/**
 * Swappable memory surface the tools and the turn stamps call.
 * A backend that cannot answer `activeByKindSubject` throws `NotSupportedError`.
 */
export type MemoryBackend = {
  store(kind: string, subject: string, content: string): Entry;
  recall(query: string, limit: number): Entry[];
  forget(id: number): void;
  forgetQuery(query: string): number;
  hydrate(query: string, limit: number): Entry[];
  get(id: number): Entry;
  activeByKindSubject(kind: string, subject: string): Entry | null;
  listBySubjectPrefix(kind: string, prefix: string, limit: number): Entry[];
};

/** MCP-style backends have no live row by subject. Callers skip the stamp. */
export class NotSupportedError extends Error {
  constructor() {
    super("memory: not supported on this backend");
    this.name = "NotSupportedError";
  }
}

export function isNotSupported(err: unknown): boolean {
  return err instanceof NotSupportedError;
}

export function isMemoryKind(kind: string): boolean {
  return KIND_SET.has(kind.trim().toLowerCase());
}

/** Canonical kind, or throws. The quoted text is the argument as passed. */
export function validateKind(kind: string): string {
  const canonical = kind.trim().toLowerCase();
  if (!KIND_SET.has(canonical)) {
    throw new Error(`memory: invalid kind ${goQuote(kind)} (want fact|preference|person|episode|insight)`);
  }
  return canonical;
}

/** Go `%q` for the strings the harness printed back to the model. */
function goQuote(s: string): string {
  let out = "\"";
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    const ch = s.charAt(i);
    if (c === 0x22 || c === 0x5c) {
      out += `\\${ch}`;
    } else if (c === 0x0a) {
      out += "\\n";
    } else if (c === 0x0d) {
      out += "\\r";
    } else if (c === 0x09) {
      out += "\\t";
    } else if (c < 0x20 || c === 0x7f) {
      out += `\\x${c.toString(16).padStart(2, "0")}`;
    } else {
      out += ch;
    }
  }
  return `${out}"`;
}

export { goQuote };
