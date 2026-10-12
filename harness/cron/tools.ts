import { errorResult, textResult, type JsonSchema, type Tool, type ToolDef } from "@/harness/core/tools";
import { KindDailyPlanner, ToolCancel, ToolList, ToolSchedule } from "./constants";
import { DefaultDailyPlannerPrompt } from "./prompts";
import { resolvePin } from "./pins";
import { parseSchedule } from "./schedule";
import { canonicalZone, formatRfc3339 } from "./time";
import type { Delivery, Job, MemoryLookup } from "./types";
import type { Store } from "./store";

const scheduleSchema: JsonSchema = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description: "what the agent should do when the job fires. For live-data jobs (calendar, mail, fitness, search, sheets), list the tools to call first and say not to invent numbers. For work-only / all-clear jobs, say to reply [silent] unless the human needs a message.",
    },
    when: {
      type: "string",
      description: "e.g. \"17:00\", \"in 2h\", RFC3339, or \"09:30\" with repeat=planner",
    },
    repeat: {
      type: "string",
      description: "once (default), daily, every:30m, or planner (move the daily planning session)",
    },
    memory_id: {
      type: "integer",
      description: "id returned by memory_store — the wake loads this row as [job memory]",
    },
    memory_subject: {
      type: "string",
      description: "fallback subject if the id is gone, e.g. follow/passport",
    },
  },
  required: ["prompt", "when"],
};

const listSchema: JsonSchema = { type: "object", properties: {} };

const cancelSchema: JsonSchema = {
  type: "object",
  properties: { id: { type: "integer" } },
  required: ["id"],
};

export function cronToolDefs(): ToolDef[] {
  return [
    {
      name: ToolSchedule,
      description: "Schedule a proactive agent turn (reminder or digest). Fires later, runs tools, and pushes the reply on this channel. Work-only jobs can reply [silent] to skip the push (all-clear / no need to ping). when: RFC3339, \"15:04\", or \"in 30m\". repeat: once|daily|every:1h|planner. repeat=planner moves the once-a-day planning session to when (a clock time like 09:30) and persists it. The planner body is fixed; prompt is ignored for that repeat. Pin follow-through with memory_id from memory_store (and/or memory_subject) so the wake loads that row.",
      inputSchema: scheduleSchema,
    },
    {
      name: ToolList,
      description: "List cron jobs (enabled and recently finished). Includes last_error after a one-shot fires or a push fails. Gone from the enabled set is not a delivery.",
      inputSchema: listSchema,
    },
    {
      name: ToolCancel,
      description: "Cancel (disable) a cron job by id from cron_list.",
      inputSchema: cancelSchema,
    },
  ];
}

export function isCronTool(name: string): boolean {
  return name === ToolSchedule || name === ToolList || name === ToolCancel;
}

export type CronToolOptions = {
  store: Store;
  /** IANA name from `CRON_TZ`. */
  zone: string;
  memory?: MemoryLookup;
  /** Clock for "in 2h" and "11:00". Defaults to the store clock. */
  now?: () => number;
};

export class CronTools {
  constructor(private readonly opts: CronToolOptions) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : this.opts.store.clock.now();
  }

  async call(name: string, args: Record<string, unknown> | null | undefined, delivery?: Delivery): Promise<string> {
    const bag = args ?? {};
    switch (name) {
      case ToolSchedule:
        return this.schedule(bag, delivery);
      case ToolList:
        return this.list();
      case ToolCancel:
        return this.cancel(bag);
      default:
        throw new Error(`cron: unknown tool ${JSON.stringify(name)}`);
    }
  }

  /** Core `Tool[]` for the agent loop. `delivery` is the turn's conversation. */
  toCoreTools(delivery: Delivery): Tool[] {
    return cronToolDefs().map((def) => ({
      ...def,
      call: async (args) => {
        try {
          return textResult(await this.call(def.name, args, delivery));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return errorResult(message);
        }
      },
    }));
  }

  private async schedule(args: Record<string, unknown>, delivery?: Delivery): Promise<string> {
    if (!delivery?.sessionId) {
      throw new Error("cron: missing delivery context (schedule from an interactive turn)");
    }
    const prompt = asString(args.prompt);
    const when = asString(args.when);
    const repeat = asString(args.repeat);
    let memorySubject = asString(args.memory_subject);
    let memoryId = 0;
    if (args.memory_id != null) memoryId = asInt(args.memory_id, "memory_id");
    const loc = canonicalZone(this.opts.zone);
    const parsed = parseSchedule(when, repeat, loc, this.now());
    if (memoryId > 0 && this.opts.memory) {
      const row = await resolvePin(this.opts.memory, memoryId, memorySubject);
      if (row) {
        memoryId = row.id;
        if (!memorySubject) memorySubject = row.subject;
      } else if (!memorySubject.trim()) {
        throw new Error(`cron: memory_id ${memoryId} not found`);
      }
    }
    let job: Job;
    if (parsed.kind === KindDailyPlanner) {
      this.opts.store.setPlannerAt(delivery.sessionId, parsed.expr);
      job = this.opts.store.ensureDailyPlanner(DefaultDailyPlannerPrompt, parsed, delivery).job;
    } else if (memoryId > 0 || memorySubject !== "") {
      job = this.opts.store.scheduleWithPin(prompt, parsed, delivery, memoryId, memorySubject);
    } else {
      job = this.opts.store.schedule(prompt, parsed, delivery);
    }
    return `scheduled id=${job.id} kind=${job.kind} next_run=${formatRfc3339(job.nextRunAt)} tz=${job.timezone} memory_id=${job.memoryId} subject=${JSON.stringify(job.memorySubject)}`;
  }

  private list(): string {
    const jobs = this.opts.store.list(true);
    if (jobs.length === 0) return "no cron jobs";
    return jobs.map(formatJobLine).join("\n");
  }

  private cancel(args: Record<string, unknown>): string {
    const id = asInt(args.id, "id");
    this.opts.store.cancel(id);
    return `cancelled id=${id}`;
  }
}

function formatJobLine(job: Job): string {
  const enabled = job.enabled ? 1 : 0;
  const lastRun = job.lastRunAt == null ? "-" : formatRfc3339(job.lastRunAt);
  return `id=${job.id} kind=${job.kind} enabled=${enabled} next=${formatRfc3339(job.nextRunAt)} last_run=${lastRun} last_error=${JSON.stringify(job.lastError)} memory_id=${job.memoryId} subject=${JSON.stringify(job.memorySubject)} prompt=${JSON.stringify(truncate(job.prompt, 80))}`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asInt(v: unknown, label: string): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return Number(v);
  throw new Error(label === "id" ? `cron: invalid id ${String(v)}` : `cron: ${label}: invalid id ${String(v)}`);
}
