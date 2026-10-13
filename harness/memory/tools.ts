import { errorResult, textResult, type CallContext, type JsonSchema, type Tool, type ToolDef, type ToolResult } from "@/harness/core/tools";
import {
  DEFAULT_RECALL_LIMIT,
  goQuote,
  KIND_INSIGHT,
  SUBJECT_AIM_PREFIX,
  type Entry,
  type MemoryBackend,
} from "./types";

export const TOOL_STORE = "memory_store";
export const TOOL_RECALL = "memory_recall";
export const TOOL_FORGET = "memory_forget";

/** Drops the aim ledger when `memory_forget` removes `insight` `aim/<area>`. */
export type ForgetAim = (area: string) => void | Promise<void>;

const STORE_DESCRIPTION = "Store one atomic memory (fact|preference|person|episode|insight). "
  + "Same kind+subject replaces the live row (old row kept, superseded). "
  + "Facts about the human (food, hours, people, events) go here — not self_note. "
  + "Months-scale plans: kind=insight, subject=aim/<area> (the sentence stays here; what happened goes to aim_log). Events: fact subject=event/<slug>. "
  + "Waiting on someone else: fact subject=waiting/<slug>. A note for you to follow up: fact subject=follow/<slug>. "
  + "A thing THEY have to do, even in passing (call, return, renew): fact subject=todo/<slug> this turn — not follow/. Store it and say you added it; never ask whether to add it. Doable now: say do it now, not good luck and not later. A clock today (4pm, 16:00): cron_schedule this turn; prompt is what to say when it fires. A future day named in the words: no cron_schedule for it and do not offer a reminder; that day's planner sets the cue. "
  + "[todo] on [agent] is that whole list with #ids, so never memory_recall for it: same subject rewrites; done is memory_forget by the #id on [todo], only when they say so. "
  + "Priority is a marker leading the words: !! urgent, ! high, none normal (\"!! file the extension\") — theirs, or your read of the stakes. [todo] sorts by it. "
  + "Hours: preference subject=pref/hours as sleep:/work:/quiet: HH:MM-HH:MM lines. "
  + "Never auto-save guesses. Jokes go in self_note.";

export function memoryToolDefs(): ToolDef[] {
  return [
    {
      name: TOOL_STORE,
      description: STORE_DESCRIPTION,
      inputSchema: objectSchema({
        kind: { type: "string", description: "fact|preference|person|episode|insight" },
        subject: { type: "string", description: "short topic key, e.g. ada, aim/training, skill/gmail" },
        content: { type: "string", description: "one atomic statement" },
      }, ["kind", "subject", "content"]),
    },
    {
      name: TOOL_RECALL,
      description: "Recall memories by free-text query (FTS5 + recency).",
      inputSchema: objectSchema({
        query: { type: "string" },
        limit: { type: "integer", description: "max rows (default 20)" },
      }, ["query"]),
    },
    {
      name: TOOL_FORGET,
      description: "Delete memory by id or by query match. Prefer id when known. A [todo] item is its #id on [agent]: forget that id, never a query (a query takes other rows with it), no memory_recall first.",
      inputSchema: objectSchema({
        id: { type: "integer", description: "memory row id" },
        query: { type: "string", description: "delete FTS matches" },
      }, []),
    },
  ];
}

export function isMemoryTool(name: string): boolean {
  return name === TOOL_STORE || name === TOOL_RECALL || name === TOOL_FORGET;
}

/**
 * The three builtin memory tools. A null backend still publishes them; calls
 * fail with `memory: backend not configured`.
 */
export function memoryTools(backend: MemoryBackend | null, forgetAim?: ForgetAim): Tool[] {
  return memoryToolDefs().map((def) => ({
    ...def,
    call(args: Record<string, unknown>, _ctx: CallContext): Promise<ToolResult> {
      return callMemoryTool(backend, def.name, args, forgetAim).then(
        (text) => textResult(text),
        (err: unknown) => errorResult(errorText(err)),
      );
    },
  }));
}

/** Runs one memory tool. Throws on a bad kind, a missing id, or an unknown name. */
export async function callMemoryTool(
  backend: MemoryBackend | null,
  name: string,
  args: Record<string, unknown> | null | undefined,
  forgetAim?: ForgetAim,
): Promise<string> {
  if (!backend) {
    throw new Error("memory: backend not configured");
  }
  const a = args ?? {};
  if (name === TOOL_STORE) {
    const entry = backend.store(asString(a.kind), asString(a.subject), asString(a.content));
    return `stored id=${String(entry.id)} kind=${entry.kind} subject=${goQuote(entry.subject)} (same subject replaces the live row)`;
  }
  if (name === TOOL_RECALL) {
    const entries = backend.recall(asString(a.query), asLimit(a.limit));
    if (entries.length === 0) {
      return "no memories matched";
    }
    return entries.map((e) => `id=${String(e.id)} (${e.kind}) ${e.subject}: ${e.content}`).join("\n");
  }
  if (name === TOOL_FORGET) {
    if ("id" in a && a.id !== undefined && a.id !== null) {
      const id = asInt64(a.id);
      let doomed: Entry[] = [];
      try {
        doomed = [backend.get(id)];
      } catch {
        // forget reports a missing id itself
      }
      backend.forget(id);
      await cascadeAims(doomed, forgetAim);
      return `forgot id=${String(id)}`;
    }
    const query = asString(a.query);
    let doomed: Entry[] = [];
    try {
      doomed = backend.recall(query, 100);
    } catch {
      // a recall miss still attempts the delete
    }
    const n = backend.forgetQuery(query);
    await cascadeAims(doomed, forgetAim);
    return `forgot ${String(n)} row(s) matching ${goQuote(query)}`;
  }
  throw new Error(`memory: unknown tool ${goQuote(name)}`);
}

async function cascadeAims(entries: readonly Entry[], forgetAim?: ForgetAim): Promise<void> {
  if (!forgetAim) {
    return;
  }
  for (const e of entries) {
    if (e.kind !== KIND_INSIGHT || !e.subject.startsWith(SUBJECT_AIM_PREFIX)) {
      continue;
    }
    const area = e.subject.slice(SUBJECT_AIM_PREFIX.length);
    if (area === "" || area === "bootstrap") {
      continue;
    }
    try {
      await forgetAim(area);
    } catch {
      // a ledger miss does not undo the forget
    }
  }
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asLimit(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.trunc(v);
  }
  return DEFAULT_RECALL_LIMIT;
}

function asInt64(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.trunc(v);
  }
  if (typeof v === "bigint") {
    return Number(v);
  }
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) {
    return Number(v.trim());
  }
  throw new Error(`memory: invalid id ${invalid(v)}`);
}

function invalid(v: unknown): string {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null || v === undefined) {
    return String(v);
  }
  return JSON.stringify(v) ?? "";
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function objectSchema(properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
  const schema: JsonSchema = {
    type: "object",
    properties,
  };
  if (required.length > 0) {
    schema.required = required;
  }
  return schema;
}
