/**
 * Sleep cycle over unconsolidated episodes. The Durable Object alarm calls
 * `pass`. `start` is the harness loop: one pass immediately, then every
 * `intervalMs` until `signal` aborts. `intervalMs <= 0` returns without a pass.
 * With no signal, `start` runs the boot pass and returns (no leaked timer).
 */
import { type Clock } from "@/brain/core/clock";
import { type Logger } from "@/brain/core/log";
import { type ChatProvider } from "@/brain/core/provider";
import { type MemoryStore } from "./store";
import { weekdayDate } from "./time";
import { goQuote, MAX_CONSOLIDATE_ATTEMPTS, type ConsolidateItem, type Entry } from "./types";

const DEFAULT_BATCH = 20;

const CONSOLIDATE_SYSTEM = `You consolidate episodic memories into durable structured rows.
Reply with ONLY a JSON array (no markdown). Each element:
{"kind":"fact|preference|person|insight","subject":"...","content":"...","supersedes":[id,...]}
Deduplicate: if a new row replaces an older memory id from this batch, list that id in supersedes.
If nothing durable, return [].
Keep content atomic (one statement). Do not invent facts not implied by episodes.
When an episode is time-bound, put an absolute date (2006-01-02) in content — never yesterday, tomorrow, or a weekday alone.`;

export type ConsolidatorOptions = {
  /** `<= 0` disables `start`. */
  intervalMs?: number;
  /** `< 1` uses 20. */
  batchSize?: number;
  /** Zone for `recorded=Mon 2006-01-02`. Defaults to the clock's zone. */
  zone?: string;
};

export class Consolidator {
  private readonly log: Logger;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly zone: string;
  private lastRunAt = 0;
  private lastError: unknown = null;

  constructor(
    private readonly store: MemoryStore,
    private readonly provider: ChatProvider,
    private readonly clock: Clock,
    log: Logger,
    options: ConsolidatorOptions = {},
  ) {
    this.log = log.with({ pkg: "memory" });
    this.intervalMs = options.intervalMs ?? 0;
    this.batchSize = options.batchSize ?? 0;
    this.zone = options.zone ?? clock.zone;
  }

  /** One bounded pass. Failures are logged and kept on `lastStatus`. */
  async pass(): Promise<void> {
    let passErr: unknown = null;
    try {
      passErr = await this.run();
    } finally {
      this.lastRunAt = this.clock.now();
      this.lastError = passErr;
    }
  }

  /**
   * Boot pass, then a timer until `signal` aborts. Disabled when `intervalMs <= 0`.
   */
  start(signal?: AbortSignal): Promise<void> {
    if (this.intervalMs <= 0) {
      return Promise.resolve();
    }
    this.log.info("memory consolidator started", { interval: `${String(this.intervalMs)}ms`, batch: this.batch() });
    return this.loop(signal);
  }

  /** `at` is 0 until a pass has finished. */
  lastStatus(): { at: number; error: unknown } {
    return { at: this.lastRunAt, error: this.lastError };
  }

  private batch(): number {
    return this.batchSize < 1 ? DEFAULT_BATCH : this.batchSize;
  }

  private async loop(signal?: AbortSignal): Promise<void> {
    await this.pass();
    if (!signal || signal.aborted) {
      this.log.info("memory consolidator stopped");
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        void this.pass();
      }, this.intervalMs);
      const stop = () => {
        clearInterval(timer);
        this.log.info("memory consolidator stopped");
        resolve();
      };
      if (signal.aborted) {
        stop();
        return;
      }
      signal.addEventListener("abort", stop, { once: true });
    });
  }

  private async run(): Promise<unknown> {
    const batch = this.batch();
    let episodes: Entry[];
    try {
      episodes = this.store.listUnconsolidatedEpisodes(batch);
    } catch (err) {
      this.log.warn("memory consolidate list failed", { err: errorText(err) });
      return err;
    }
    if (episodes.length === 0) {
      this.log.debug("memory consolidate: nothing to do");
      return null;
    }
    const ids = episodes.map((e) => e.id);
    const allowed = new Set(ids);
    let result;
    try {
      result = await this.provider.complete({
        messages: [
          { role: "system", content: CONSOLIDATE_SYSTEM },
          { role: "user", content: buildConsolidatePrompt(episodes, this.zone) },
        ],
      });
    } catch (err) {
      this.log.warn("memory consolidate llm failed", { err: errorText(err) });
      return err;
    }
    let items: ConsolidateItem[];
    try {
      items = parseConsolidateJSON(result.content);
    } catch (err) {
      this.log.warn("memory consolidate parse failed", { err: errorText(err), raw: truncate(result.content, 200) });
      try {
        this.store.recordConsolidateFailure(ids, MAX_CONSOLIDATE_ATTEMPTS);
      } catch (qerr) {
        this.log.warn("memory consolidate failure record failed", { err: errorText(qerr) });
      }
      return err;
    }
    try {
      const stored = this.store.applyConsolidation(ids, items, allowed);
      this.log.info("memory consolidate pass", { episodes: episodes.length, extracted: items.length, stored });
      return null;
    } catch (err) {
      this.log.warn("memory consolidate apply failed", { err: errorText(err) });
      return err;
    }
  }
}

/** Prompt body: each episode with the local day it was recorded. */
export function buildConsolidatePrompt(episodes: readonly Entry[], zone = "UTC"): string {
  const loc = zone || "UTC";
  let out = "Unconsolidated episodes:\n";
  for (const e of episodes) {
    const when = e.createdAt !== 0 ? ` recorded=${weekdayDate(e.createdAt, loc)}` : "";
    out += `- id=${String(e.id)}${when} subject=${goQuote(e.subject)}: ${e.content}\n`;
  }
  return out;
}

function parseConsolidateJSON(raw: string): ConsolidateItem[] {
  let text = raw.trim();
  if (text === "") {
    throw new Error("empty consolidator reply");
  }
  if (text.startsWith("```")) {
    text = trimPrefix(text, "```json");
    text = trimPrefix(text, "```JSON");
    text = trimPrefix(text, "```");
    const end = text.lastIndexOf("```");
    if (end >= 0) {
      text = text.slice(0, end);
    }
    text = text.trim();
    if (text === "") {
      throw new Error("empty consolidator reply after fence strip");
    }
  }
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error("consolidator reply is not an array");
  }
  return parsed.map(parseItem);
}

function parseItem(value: unknown): ConsolidateItem {
  if (!isRecord(value)) {
    throw new Error("consolidator item");
  }
  const kind = value.kind === undefined ? "" : value.kind;
  const subject = value.subject === undefined ? "" : value.subject;
  const content = value.content === undefined ? "" : value.content;
  if (typeof kind !== "string" || typeof subject !== "string" || typeof content !== "string") {
    throw new Error("consolidator item field");
  }
  let supersedes: number[] = [];
  if (value.supersedes !== undefined && value.supersedes !== null) {
    if (!Array.isArray(value.supersedes)) {
      throw new Error("consolidator supersedes");
    }
    supersedes = value.supersedes.map((id) => {
      if (typeof id !== "number" || !Number.isInteger(id)) {
        throw new Error("consolidator supersede id");
      }
      return id;
    });
  }
  return { kind, subject, content, supersedes };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function trimPrefix(s: string, prefix: string): string {
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) {
    return s;
  }
  return `${s.slice(0, n)}\u2026`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
