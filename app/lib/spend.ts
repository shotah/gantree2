import type { SampleRow } from "@/lib/door/settingsStore";

/**
 * Pasted $ / 1M tokens. Same localStorage shape as the helpers in
 * `app/lib/prefs.ts`: a key, a reader, and a writer over a storage object.
 */
export const SPEND_RATE_KEY = "gantree.spend.rate";

export const SPEND_WINDOWS = ["today", "7d", "30d"] as const;
export type SpendWindow = (typeof SPEND_WINDOWS)[number];

const DAY_MS = 86_400_000;
const KINDS = new Set(["tokens_prompt", "tokens_completion", "turn"]);

type ReadStore = { getItem(key: string): string | null };
type WriteStore = { setItem(key: string, value: string): void; removeItem?(key: string): void };

export type AgentSpend = {
  agent: string;
  prompt: number;
  completion: number;
  turns: number;
  usd: number | null;
};

export type SpendRollup = {
  window: SpendWindow;
  since: number;
  prompt: number;
  completion: number;
  turns: number;
  usd: number | null;
  agents: AgentSpend[];
};

/** Midnight local for today; rolling 7 and 30 days otherwise. */
export function windowStart(window: SpendWindow, now = Date.now()): number {
  if (window === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  if (window === "7d") {
    return now - 7 * DAY_MS;
  }
  return now - 30 * DAY_MS;
}

/** One rate for prompt and completion. `null` means no estimate yet. */
export function estSpendUsd(prompt: number, completion: number, rate: number | null): number | null {
  if (rate == null) {
    return null;
  }
  return ((prompt + completion) / 1_000_000) * rate;
}

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) {
    return "$0";
  }
  if (n < 0.01) {
    return `$${n.toFixed(4)}`;
  }
  return `$${n.toFixed(2)}`;
}

export function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) {
    return "0";
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 10_000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(2)}k`;
  }
  return String(Math.round(n));
}

/** Leading number, optional `$`. Trailing words ("/ 1M") are ignored. */
export function parseSpendRate(raw: string): number | null {
  let text = raw.replace(/,/g, "").trim();
  if (text.startsWith("$")) text = text.slice(1).trim();
  const match = /^(\d+\.\d+|\d+)/.exec(text);
  if (!match) {
    return null;
  }
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return n;
}

export function readSpendRate(storage: ReadStore | null | undefined): number | null {
  const raw = storage?.getItem(SPEND_RATE_KEY);
  if (raw == null) {
    return null;
  }
  return parseSpendRate(raw);
}

export function writeSpendRate(storage: WriteStore, rate: number | null): void {
  if (rate == null || !Number.isFinite(rate) || rate < 0) {
    if (storage.removeItem) {
      storage.removeItem(SPEND_RATE_KEY);
      return;
    }
    storage.setItem(SPEND_RATE_KEY, "");
    return;
  }
  storage.setItem(SPEND_RATE_KEY, String(rate));
}

export function browserSpendRate(): number | null {
  if (typeof window === "undefined") {
    return null;
  }
  return readSpendRate(window.localStorage);
}

export function saveSpendRate(rate: number | null): void {
  if (typeof window === "undefined") {
    return;
  }
  writeSpendRate(window.localStorage, rate);
}

export function samplesQuery(since: number, agent?: string): string {
  const params = new URLSearchParams({ since: String(Math.trunc(since)) });
  if (agent) {
    params.set("agent", agent);
  }
  return `/api/samples?${params.toString()}`;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

/** `{ samples: SampleRow[] }` from `GET /api/samples`. Junk rows drop out. */
export function parseSamples(body: unknown): SampleRow[] {
  if (!body || typeof body !== "object") {
    return [];
  }
  const samples = (body as { samples?: unknown }).samples;
  if (!Array.isArray(samples)) {
    return [];
  }
  const out: SampleRow[] = [];
  for (const row of samples) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const record = row as Record<string, unknown>;
    const at = asNumber(record.at);
    const value = asNumber(record.value);
    if (at == null || value == null || typeof record.agent !== "string" || typeof record.kind !== "string") {
      continue;
    }
    out.push({ id: asNumber(record.id) ?? out.length + 1, at, agent: record.agent, kind: record.kind, value });
  }
  return out;
}

type Bucket = { prompt: number; completion: number; turns: number };

/** Prompt, completion, and turns per agent inside the window. */
export function rollupSamples(
  samples: readonly SampleRow[],
  window: SpendWindow,
  rate: number | null,
  now = Date.now(),
): SpendRollup {
  const since = windowStart(window, now);
  const byAgent = new Map<string, Bucket>();
  for (const sample of samples) {
    if (sample.at < since || !KINDS.has(sample.kind)) {
      continue;
    }
    const agent = sample.agent.trim();
    if (!agent || !Number.isFinite(sample.value) || sample.value < 0) {
      continue;
    }
    const bucket = byAgent.get(agent) ?? { prompt: 0, completion: 0, turns: 0 };
    if (sample.kind === "tokens_prompt") {
      bucket.prompt += sample.value;
    } else if (sample.kind === "tokens_completion") {
      bucket.completion += sample.value;
    } else {
      bucket.turns += sample.value;
    }
    byAgent.set(agent, bucket);
  }
  const agents = [...byAgent.entries()]
    .map(([agent, bucket]) => ({
      agent,
      prompt: bucket.prompt,
      completion: bucket.completion,
      turns: bucket.turns,
      usd: estSpendUsd(bucket.prompt, bucket.completion, rate),
    }))
    .sort((a, b) => (b.prompt + b.completion) - (a.prompt + a.completion) || a.agent.localeCompare(b.agent));
  const prompt = agents.reduce((sum, row) => sum + row.prompt, 0);
  const completion = agents.reduce((sum, row) => sum + row.completion, 0);
  const turns = agents.reduce((sum, row) => sum + row.turns, 0);
  return {
    window,
    since,
    prompt,
    completion,
    turns,
    usd: estSpendUsd(prompt, completion, rate),
    agents,
  };
}
