/**
 * Slash commands the Go agent answered without a model call. `/cancel` is
 * handled by the facade so it can abort an in-flight turn.
 */
import type { ChatProvider } from "@/brain/core/provider";
import type { Plugin, PluginContext } from "@/brain/core/tools";
import { helpText } from "@/brain/slash";
import { ledgerParts } from "@/brain/session/summary";
import type { SessionStore } from "@/brain/session/store";
import type { MemoryStore } from "@/brain/memory/store";
import { formatHydration } from "@/brain/memory/format";
import { horizonAge } from "@/brain/memory/horizon";
import { sortTodo, todoPriority, todoWords } from "@/brain/memory/todo";
import {
  KIND_EPISODE,
  KIND_FACT,
  SUBJECT_TODO_PREFIX,
} from "@/brain/memory/types";
import type { AimStore } from "@/brain/aims/store";
import { addDays, localDay } from "@/brain/aims/calendar";
import { RUBRIC_TEXT } from "@/brain/aims/rubric";
import { formatLine, suffix } from "@/brain/aims/text";
import { restoreQuotedLines } from "@/brain/selfnote/graduate";
import type { SelfNoteStore } from "@/brain/selfnote/store";
import type { EnableStore } from "@/brain/tools/enable";
import { enableHoldReply, formatIndexStatus, parseEnableHoldCommand } from "@/brain/tools/enable";
import type { Registry } from "@/brain/tools/registry";
import type { Consolidator } from "@/brain/memory/consolidate";
import { PlannerOff } from "@/brain/cron/constants";
import type { PlannerService } from "@/brain/cron/planner";
import { formatPlannerAt, parsePlannerAt } from "@/brain/cron/schedule";
import type { ExamplesService } from "@/brain/examples/service";
import { fallbackFormat, noMatchMessage, offHint } from "@/brain/examples/seeds";
import { roomAuth, type RoomAuth } from "@/brain/room/authbind";
import { clipChars } from "./judgment";
import { SELF_DISTILL_MIN_MESSAGES, SELF_DISTILL_PROMPT } from "./notes";

const AIMS_USAGE = "usage: /aims [area | rubric | block <area> <from> <to>]";
const TODO_USAGE = "usage: /todo [done <id|slug>] [prio <id|slug> [!!|!]]";
const TODO_LONG = 10;
const PLANNER_USAGE = "usage: /planner (on | off | 07:10)";
const AUTH_GUIDE = "https://github.com/shotah/ai-gantry/blob/main/docs/auth.md";

export type SlashEnv = {
  sessions: SessionStore;
  memory: MemoryStore;
  aims: AimStore;
  selfNote: SelfNoteStore;
  enable: EnableStore;
  registry: Registry;
  consolidator: Consolidator;
  /** `0` when consolidation is not scheduled. */
  consolidateMinutes: number;
  planner: PlannerService;
  examples: ExamplesService;
  plugins: readonly Plugin[];
  pluginCtx: PluginContext;
  provider: ChatProvider;
  persona: () => string;
  zone: () => string;
  now: () => number;
  startedAt: number;
  model: string;
  dynamic: boolean;
  turnCount: () => number;
  formatPerf: () => string;
  formatToolStats: () => string;
  redirectUri: string;
};

export function commandFields(text: string): string[] {
  const fields = text.trim().split(/\s+/u).filter((part) => part !== "");
  if (fields.length === 0) return [];
  const first = fields[0] ?? "";
  const at = first.indexOf("@");
  fields[0] = (at >= 0 ? first.slice(0, at) : first).toLowerCase();
  return fields;
}

/** Null when the text is not a slash command this package handles. */
export async function runSlash(env: SlashEnv, sessionId: string, text: string): Promise<string | null> {
  const hold = parseEnableHoldCommand(text);
  if (hold) {
    const store = env.dynamic ? env.enable : null;
    return enableHoldReply(store, sessionId, hold.cmd, hold.prefix, env.registry.indexKeys());
  }
  const fields = commandFields(text);
  const cmd = fields[0] ?? "";
  if (!cmd.startsWith("/")) return null;
  if (cmd === "/auth") return auth(env, fields.slice(1));
  if (cmd === "/examples") return examplesCmd(env, sessionId, (fields[1] ?? "").toLowerCase());
  if (cmd === "/aims") return aimsCmd(env, fields.slice(1));
  if (cmd === "/todo") return todoCmd(env, fields.slice(1));
  if (cmd === "/planner") return plannerCmd(env, sessionId, (fields[1] ?? "").toLowerCase());
  if (fields.length !== 1) return null;
  switch (cmd) {
    case "/new":
    case "/clear":
      return resetSession(env, sessionId);
    case "/status":
      return statusLine(env, sessionId);
    case "/tools":
      return listTools(env, sessionId);
    case "/perf":
      return env.formatPerf();
    case "/memstats":
      return memstats(env);
    case "/toolstats":
      return env.formatToolStats();
    case "/tokens":
      return tokenLine(env, sessionId);
    case "/help":
      return helpText();
    default:
      return null;
  }
}

export async function startAuth(
  env: Pick<SlashEnv, "plugins" | "pluginCtx">,
  pluginName: string,
  redirectUri: string,
  state: string,
): Promise<{ url: string } | null> {
  const plugin = env.plugins.find((p) => p.name === pluginName);
  if (!plugin?.authStart) return null;
  const started = await plugin.authStart(env.pluginCtx, redirectUri, state);
  return { url: started.url };
}

export async function finishAuth(
  env: Pick<SlashEnv, "plugins" | "pluginCtx">,
  pluginName: string,
  redirectUri: string,
  code: string,
): Promise<void> {
  const plugin = env.plugins.find((p) => p.name === pluginName);
  if (!plugin?.authFinish) throw new Error(`auth: ${pluginName} has no login`);
  await plugin.authFinish(env.pluginCtx, redirectUri, code);
}

async function resetSession(env: SlashEnv, sessionId: string): Promise<string> {
  const parked = parkFacts(env, sessionId);
  const distilled = await distill(env, sessionId);
  env.sessions.reset(sessionId);
  if (distilled && parked) return "session reset — personality distilled into SELF.md; session facts parked in memory";
  if (distilled) return "session reset — personality distilled into SELF.md";
  if (parked) return "session reset — session facts parked in memory";
  return "session reset";
}

function parkFacts(env: SlashEnv, sessionId: string): boolean {
  const { facts } = ledgerParts(env.sessions.summary(sessionId));
  if (facts.trim() === "") return false;
  try {
    env.memory.store(KIND_EPISODE, "session", facts);
    return true;
  } catch {
    return false;
  }
}

async function distill(env: SlashEnv, sessionId: string): Promise<boolean> {
  const history = env.sessions.messages(sessionId);
  const { voice } = ledgerParts(env.sessions.summary(sessionId));
  if (history.length < SELF_DISTILL_MIN_MESSAGES && voice.trim() === "") return false;
  if (voice.trim() === "" && !history.some((m) => hasQuoted(m.content))) return false;
  let current = env.selfNote.read();
  if (current.trim() === "") current = "(none yet)";
  const transcript = history.slice(-60).map((m) => `${m.role}: ${clipChars(m.content, 400)}`).join("\n");
  const messages: { role: "system" | "user"; content: string }[] = [
    { role: "system", content: SELF_DISTILL_PROMPT },
    { role: "system", content: `[current SELF.md]\n${current}` },
  ];
  if (voice.trim() !== "") messages.push({ role: "system", content: `[session voice]\n${voice}` });
  messages.push({ role: "user", content: `[transcript]\n${transcript}` });
  try {
    const res = await env.provider.complete({ messages });
    let content = stripFence(res.content.trim());
    if (content === "") return false;
    if (current !== "(none yet)") content = restoreQuotedLines(current, content);
    env.selfNote.write(content);
    return true;
  } catch {
    return false;
  }
}

function hasQuoted(s: string): boolean {
  const i = s.indexOf("\"");
  return i >= 0 && s.indexOf("\"", i + 1) >= 0;
}

function stripFence(s: string): string {
  if (!s.startsWith("```")) return s;
  let body = s.trim().replace(/```$/u, "").trim();
  const nl = body.indexOf("\n");
  if (nl >= 0) body = body.slice(nl + 1).trim();
  return body;
}

function statusLine(env: SlashEnv, sessionId: string): string {
  const stats = env.sessions.stats(sessionId);
  const defs = published(env, sessionId);
  return `uptime=${formatUptime(env.now() - env.startedAt)} model=${env.model} history_messages=${String(stats.messages)} history_est_tokens=${String(stats.estTokens)} tools=${String(defs.length)} schema_est_tokens=${String(schemaEst(defs))} turns=${String(env.turnCount())}`;
}

function listTools(env: SlashEnv, sessionId: string): string {
  const defs = published(env, sessionId);
  if (defs.length === 0) return "tools: (none)";
  const names = defs.map((d) => d.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const by = new Map<string, { tools: number; chars: number }>();
  let chars = 0;
  for (const d of defs) {
    const n = defChars(d);
    chars += n;
    const cut = d.name.indexOf("__");
    const server = cut > 0 ? d.name.slice(0, cut) : "builtin";
    const row = by.get(server) ?? { tools: 0, chars: 0 };
    row.tools += 1;
    row.chars += n;
    by.set(server, row);
  }
  const lines = [`tools (${String(defs.length)}) schema_est_tokens≈${String(Math.trunc(chars / 4))} (chars/4)`];
  const index = formatIndexStatus(env.enable.list(sessionId), env.registry.indexKeys(), { prefixes: [] }, env.now());
  if (index !== "") lines.push(index);
  lines.push("by server:");
  const servers = [...by.entries()].sort((a, b) => b[1].chars - a[1].chars || (a[0] < b[0] ? -1 : 1));
  for (const [server, row] of servers) {
    lines.push(`  ${server}: ${String(row.tools)} tools ≈ ${String(Math.trunc(row.chars / 4))}`);
  }
  for (const name of names) {
    const cut = name.indexOf("__");
    if (cut > 0) lines.push(`- ${name}  (server=${name.slice(0, cut)} tool=${name.slice(cut + 2)})`);
    else lines.push(`- ${name}`);
  }
  return lines.join("\n");
}

function memstats(env: SlashEnv): string {
  const snap = env.memory.stats();
  const lines = [
    `memory: ${String(snap.total)} rows  fact=${String(snap.byKind.fact ?? 0)} preference=${String(snap.byKind.preference ?? 0)} person=${String(snap.byKind.person ?? 0)} insight=${String(snap.byKind.insight ?? 0)} episode=${String(snap.byKind.episode ?? 0)}`,
    `state: active=${String(snap.active)} expired=${String(snap.expired)} superseded=${String(snap.superseded)}`,
  ];
  const last = env.consolidator.lastStatus();
  if (env.consolidateMinutes <= 0 && last.at === 0) {
    lines.push("consolidation: off");
  } else {
    const status = last.error instanceof Error ? last.error.message : "ok";
    const when = last.at === 0 ? "never" : clockTime(last.at, env.zone());
    lines.push(`consolidation: backlog=${String(snap.backlog)} episodes  quarantined=${String(snap.quarantined)}  last_run=${when} ${status}`);
  }
  lines.push(`db: ${formatBytes(snap.dbBytes)} (WAL)`);
  return lines.join("\n");
}

function tokenLine(env: SlashEnv, sessionId: string): string {
  const persona = env.persona();
  const personaEst = estChars(persona);
  const summary = env.sessions.summary(sessionId).trim();
  let summaryEst = 0;
  let voiceNote = "Voice: (none)";
  if (summary !== "") {
    summaryEst = estChars(`[session summary]\n${summary}`);
    if (ledgerParts(summary).voice.trim() !== "") voiceNote = "Voice: yes";
  }
  const stats = env.sessions.stats(sessionId);
  const schema = schemaEst(published(env, sessionId));
  const entries = env.memory.hydrate(lastUser(env, sessionId), 30);
  const hydro = formatHydration(entries, env.zone());
  const hydrateEst = hydro === "" ? 0 : estChars(hydro);
  const standing = personaEst + summaryEst + stats.estTokens + hydrateEst + schema;
  return [
    "tokens (chars/4 estimates)",
    `  persona     ${String(personaEst)}`,
    `  summary     ${String(summaryEst)}  (${voiceNote})`,
    `  history     ${String(stats.estTokens)}  (${String(stats.messages)} msgs)`,
    `  hydration   ${String(hydrateEst)}  (${String(entries.length)} rows)`,
    `  schemas     ${String(schema)}`,
    `  standing    ${String(standing)}`,
  ].join("\n");
}

function aimsCmd(env: SlashEnv, args: string[]): string {
  if (args.length === 0) return aimsBoard(env);
  const head = (args[0] ?? "").toLowerCase();
  if (head === "rubric") return RUBRIC_TEXT;
  if (head === "block") {
    if (args.length !== 4) return AIMS_USAGE;
    env.aims.setBlock(args[1] ?? "", args[2] ?? "", args[3] ?? "");
    return `block ${args[1] ?? ""} ${args[2] ?? ""}..${args[3] ?? ""}`;
  }
  if (args.length !== 1) return AIMS_USAGE;
  return aimsArea(env, args[0] ?? "");
}

function aimsBoard(env: SlashEnv): string {
  const areas = env.aims.areas();
  if (areas.length === 0) return "no aims — memory_store insight aim/<area> opens one";
  const now = env.now();
  const lines: string[] = [];
  for (const area of areas) {
    const s = suffix(env.aims.statsAt(area, now));
    lines.push(s !== "" ? `${area} — ${s}` : `${area} — no ledger yet`);
  }
  const extra = env.aims.boardTrend(areas, now);
  if (extra !== "") lines.push(extra);
  return lines.join("\n");
}

function aimsArea(env: SlashEnv, area: string): string {
  const areas = env.aims.areas();
  if (!areas.includes(area)) {
    if (areas.length === 0) return "no aims — memory_store insight aim/<area> opens one";
    return `unknown aim ${JSON.stringify(area)} (live: ${areas.join(", ")})`;
  }
  const now = env.now();
  const today = localDay(now, env.zone());
  const from = addDays(today, -13);
  const rows = env.aims.history(area, from, today, 50);
  const s = suffix(env.aims.statsAt(area, now));
  const lines = [s !== "" ? `${area} — ${s}` : area];
  const trend = env.aims.areaTrend(area, now);
  if (trend !== "") lines.push(trend);
  if (rows.length === 0) {
    lines.push("no ledger rows");
    return lines.join("\n");
  }
  for (const ev of rows) lines.push(formatLine(ev));
  return lines.join("\n");
}

function todoCmd(env: SlashEnv, args: string[]): string {
  if (args.length === 0) return todoList(env);
  if (args.length === 2 && (args[0] ?? "").toLowerCase() === "done") return todoDone(env, args[1] ?? "");
  if ((args.length === 2 || args.length === 3) && (args[0] ?? "").toLowerCase() === "prio") {
    return todoPrio(env, args[1] ?? "", args[2] ?? "");
  }
  return TODO_USAGE;
}

function todoList(env: SlashEnv): string {
  const rows = env.memory.listBySubjectPrefix(KIND_FACT, SUBJECT_TODO_PREFIX, 0);
  if (rows.length === 0) return "nothing on the list";
  const now = env.now();
  const lines: string[] = [];
  for (const e of sortTodo(rows)) {
    const slug = e.subject.trim().slice(SUBJECT_TODO_PREFIX.length);
    const words = todoWords(e.content).split(/\s+/u).filter((w) => w !== "").join(" ");
    const age = horizonAge(e, now);
    lines.push(age === "" ? `#${String(e.id)} ${slug}: ${words}` : `#${String(e.id)} ${slug}: ${words} ${age}`);
  }
  if (rows.length > TODO_LONG) lines.push(`${String(rows.length)} open — a pocket list; prune, or use a tracker`);
  return lines.join("\n");
}

function todoDone(env: SlashEnv, key: string): string {
  const found = todoFind(env, key);
  if (typeof found === "string") return found;
  env.memory.forget(found.id);
  return `done: #${String(found.id)} ${found.subject.slice(SUBJECT_TODO_PREFIX.length)}`;
}

function todoPrio(env: SlashEnv, key: string, marker: string): string {
  if (marker !== "" && marker !== "!" && marker !== "!!") return TODO_USAGE;
  const found = todoFind(env, key);
  if (typeof found === "string") return found;
  const words = todoPriority(found.content).text;
  const content = marker === "" ? words : `${marker} ${words}`;
  const next = env.memory.store(KIND_FACT, found.subject, content);
  return `#${String(next.id)} ${found.subject.slice(SUBJECT_TODO_PREFIX.length)}: ${todoWords(next.content)}`;
}

function todoFind(
  env: SlashEnv,
  key: string,
): { id: number; subject: string; content: string } | string {
  const trimmed = key.trim();
  if (trimmed === "") return TODO_USAGE;
  const gone = `todo: ${/^\d+$/u.test(trimmed) ? `#${trimmed}` : trimmed} is gone — the list was updated`;
  if (/^\d+$/u.test(trimmed)) {
    try {
      const e = env.memory.get(Number(trimmed));
      if (e.supersededBy != null || !e.subject.startsWith(SUBJECT_TODO_PREFIX)) return gone;
      return e;
    } catch {
      return gone;
    }
  }
  const slug = trimmed.toLowerCase().replace(/^todo\//u, "");
  const e = env.memory.activeByKindSubject(KIND_FACT, `${SUBJECT_TODO_PREFIX}${slug}`);
  if (!e) return gone;
  return e;
}

function plannerCmd(env: SlashEnv, sessionId: string, arg: string): string {
  const delivery = { sessionId };
  if (arg === "") return plannerStatus(env, sessionId);
  if (arg === "on" || arg === "true") {
    env.planner.setAt(sessionId, "");
    env.planner.ensureFor(delivery);
    return `planner on — daily planning session at ${env.planner.defaultAt()} (move with /planner 09:30, off with /planner off)`;
  }
  if (arg === "off" || arg === "false") {
    env.planner.setAt(sessionId, PlannerOff);
    env.planner.ensureFor(delivery);
    return "planner off — no daily planning session; reminders you scheduled still fire. /planner on to resume";
  }
  let at: string;
  try {
    const parsed = parsePlannerAt(arg);
    at = formatPlannerAt(parsed.hour, parsed.minute);
  } catch {
    return PLANNER_USAGE;
  }
  env.planner.setAt(sessionId, at);
  env.planner.ensureFor(delivery);
  return `planner at ${at} — /planner off to stop, /planner on for the default (${env.planner.defaultAt()})`;
}

function plannerStatus(env: SlashEnv, sessionId: string): string {
  const resolved = env.planner.resolvedAt(sessionId);
  const pref = env.planner.sessionAt(sessionId);
  let chat = `default (${env.planner.defaultAt()})`;
  if (pref === PlannerOff || resolved === PlannerOff) chat = "off";
  else if (pref !== "") chat = pref;
  return `daily planner (/planner)\ndefault: ${env.planner.defaultAt()}\nthis agent: ${chat}\n${PLANNER_USAGE}`;
}

async function examplesCmd(env: SlashEnv, sessionId: string, arg: string): Promise<string> {
  const delivery = { sessionId };
  if (arg === "on" || arg === "true") {
    env.examples.setEnabled(sessionId, true);
    if (!env.examples.proactiveEnabled()) {
      return "examples on for this agent — proactive pings are disabled by EXAMPLES_QTY; /examples still works anytime";
    }
    env.examples.ensureFor(delivery);
    return "examples on — you'll get occasional capability ideas (turn off with /examples off)";
  }
  if (arg === "off" || arg === "false") {
    env.examples.setEnabled(sessionId, false);
    return "examples off — no more proactive ideas; /examples still works anytime to request one";
  }
  if (arg !== "") return "usage: /examples | /examples on | /examples off";
  const hit = env.examples.suggestPrompt();
  if (!hit) return noMatchMessage;
  try {
    const res = await env.provider.complete({
      messages: [
        { role: "system", content: env.persona() },
        { role: "user", content: hit.prompt },
      ],
    });
    const reply = res.content.trim();
    if (reply === "") return fallbackFormat(hit.seed);
    if (reply.toLowerCase().includes("/examples off")) return reply;
    return `${reply}\n\n${offHint}`;
  } catch {
    return fallbackFormat(hit.seed);
  }
}

const NATIVE_LANDING = "Open it, approve, and you'll land back here connected.";

function authError(err: unknown): string {
  return err instanceof Error && err.message.trim() !== "" ? err.message : "login failed";
}

/** Room-bound native agent: sealed catch state, no code paste. */
async function nativeAuth(env: SlashEnv, args: string[], bound: RoomAuth): Promise<string> {
  const withAuth = env.plugins.filter((plugin) => typeof plugin["authStart"] === "function");
  if (args.length === 0) {
    if (withAuth.length === 0) return "auth: no plugins with a login";
    return withAuth.map((p) => `/auth ${p.name}`).join("\n");
  }
  const name = (args[0] ?? "").trim();
  const plugin = env.plugins.find((p) => p.name === name);
  if (!plugin) return `auth: unknown server ${JSON.stringify(name)}`;
  if (!plugin.authStart || !plugin.authFinish) return `auth: server ${JSON.stringify(name)} has no login`;
  if (args.length > 1) {
    return `auth: not needed. ${NATIVE_LANDING}`;
  }
  let redirectUri: string;
  try {
    redirectUri = (await bound.redirectUri()).trim();
  } catch (err) {
    return `auth: ${authError(err)}`;
  }
  if (redirectUri === "") return "auth: no public origin";
  let state: string;
  try {
    state = await bound.sealState(name);
  } catch (err) {
    return `auth: ${authError(err)}`;
  }
  try {
    const started = await plugin.authStart(env.pluginCtx, redirectUri, state);
    const lines = [started.url];
    if (started.instruction) lines.push(started.instruction);
    lines.push(NATIVE_LANDING);
    return lines.join("\n");
  } catch (err) {
    return `auth: ${authError(err)}`;
  }
}

async function auth(env: SlashEnv, args: string[]): Promise<string> {
  const bound = roomAuth(env.pluginCtx.sql);
  if (bound) return nativeAuth(env, args, bound);
  const withAuth = env.plugins.filter((plugin) => typeof plugin["authStart"] === "function");
  if (args.length === 0) {
    if (withAuth.length === 0) return "auth: no plugins with a login";
    return withAuth.map((p) => `/auth ${p.name}`).join("\n");
  }
  const name = (args[0] ?? "").trim();
  const plugin = env.plugins.find((p) => p.name === name);
  if (!plugin) return `auth: unknown server ${JSON.stringify(name)}`;
  if (!plugin.authStart || !plugin.authFinish) return `auth: server ${JSON.stringify(name)} has no login`;
  const code = args.slice(1).join(" ").trim();
  if (env.redirectUri === "") return `auth: set OAUTH_REDIRECT_URI\nguide: ${AUTH_GUIDE}`;
  if (code === "") {
    const started = await plugin.authStart(env.pluginCtx, env.redirectUri, `auth-${String(env.now())}`);
    const lines = [started.url];
    if (started.instruction) lines.push(started.instruction);
    lines.push(`guide: ${AUTH_GUIDE}`);
    return lines.join("\n");
  }
  await plugin.authFinish(env.pluginCtx, env.redirectUri, code);
  return `auth: ${name} connected`;
}

type Listed = { name: string; description: string; inputSchema: unknown };

function published(env: SlashEnv, sessionId: string): Listed[] {
  const enabled = env.enable.list(sessionId).map((row) => row.prefix);
  return env.registry.list(enabled);
}

function defChars(d: Listed): number {
  return d.name.length + d.description.length + JSON.stringify(d.inputSchema).length;
}

function schemaEst(defs: readonly Listed[]): number {
  let chars = 0;
  for (const d of defs) chars += defChars(d);
  return Math.trunc(chars / 4);
}

function lastUser(env: SlashEnv, sessionId: string): string {
  const msgs = env.sessions.messages(sessionId);
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (m?.role === "user") return m.content;
  }
  return "";
}

function estChars(s: string): number {
  if (s === "") return 0;
  return Math.trunc((s.length + 3) / 4);
}

export function formatUptime(ms: number): string {
  const d = ms < 0 ? 0 : Math.trunc(ms / 1000) * 1000;
  const h = Math.trunc(d / 3_600_000);
  const m = Math.trunc(d / 60_000) % 60;
  const s = Math.trunc(d / 1000) % 60;
  if (h > 0) return `${String(h)}h${String(m)}m`;
  if (m > 0) return `${String(m)}m${String(s)}s`;
  return `${String(s)}s`;
}

function formatBytes(n: number): string {
  const v = n < 0 ? 0 : n;
  if (v >= 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${String(v)} B`;
}

function clockTime(ms: number, zone: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return fmt.format(new Date(ms));
}
