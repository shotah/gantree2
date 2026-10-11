#!/usr/bin/env -S node --experimental-transform-types --disable-warning=ExperimentalWarning
/**
 * In-process brain REPL. Talks to the real model and the real plugins.
 *
 *   npm run agent -- --slug kit --db .agent/kit.sqlite --fresh
 *
 * Loads `.dev.vars` the same way `scripts/eval.mjs` does (existing
 * environment wins; values are never printed). Persists one `node:sqlite`
 * file so memory, aims, cron, persona, and SELF.md survive a restart.
 * `--once`, or a stdin that is not a terminal, reads lines until EOF and
 * exits. Ctrl-C closes the database and exits.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import * as nodeModule from "node:module";
import { isAbsolute, dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PERSONA_TEMPLATE } from "../app/components/agents/personaTemplate.ts";
import { type NodeDatabase, type Sql } from "../brain/core/sql.ts";
import { type BrainFrame, type Inbound, type PerfFrame, type StatusFrame } from "../brain/core/wire.ts";

/** Loopback catch the Worker serves. The REPL cannot receive that redirect. */
export const LOOPBACK_REDIRECT = "http://127.0.0.1:3000/api/auth/catch";

/** Printed after every `/auth` reply. The brain's own text stays unchanged. */
export const AUTH_REPL_NOTE = `The catch redirect does not run outside the Worker. Paste the code: /auth <plugin> <code> with redirect ${LOOPBACK_REDIRECT}.`;

/** Fixed local user. Not an account and not a secret. */
export const DEV_USER = "dev";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SLUG = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/;
const SECRET_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|BEARER)/i;
const MAX_TIMER = 2_147_483_647;

export type AgentArgs = {
  slug: string;
  /** Null selects `.agent/<slug>.sqlite` under the working directory. */
  db: string | null;
  fresh: boolean;
  verbose: boolean;
  once: boolean;
};

export type FrameView = {
  text: string;
  /** Replace the current line (typing spinner, cumulative draft). */
  overwrite: boolean;
  dim: boolean;
};

export type PaintState = { pending: boolean };

const secrets: string[] = [];

export function parseArgs(argv: string[]): AgentArgs {
  let slug = "kit";
  let db: string | null = null;
  let fresh = false;
  let verbose = false;
  let once = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--") continue;
    if (arg === "--fresh") {
      fresh = true;
      continue;
    }
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    if (arg === "--once") {
      once = true;
      continue;
    }
    if (arg === "--slug" || arg.startsWith("--slug=")) {
      if (arg === "--slug") {
        i += 1;
        slug = take(argv, i, "--slug");
      } else {
        slug = arg.slice("--slug=".length);
      }
      continue;
    }
    if (arg === "--db" || arg.startsWith("--db=")) {
      if (arg === "--db") {
        i += 1;
        db = take(argv, i, "--db");
      } else {
        db = arg.slice("--db=".length);
      }
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}`);
    throw new Error(`unexpected argument ${arg}`);
  }
  if (!SLUG.test(slug)) throw new Error(`bad slug ${JSON.stringify(slug)}`);
  if (db != null && db.trim() === "") throw new Error("missing value for --db");
  return { slug, db, fresh, verbose, once };
}

export function dbPath(slug: string, db: string | null, cwd: string): string {
  if (db != null && db !== "") return resolve(cwd, db);
  return resolve(cwd, ".agent", `${slug}.sqlite`);
}

/** Relative to `cwd` when the file lives under it, otherwise absolute. */
export function displayDb(abs: string, cwd: string): string {
  const rel = relative(cwd, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return abs;
  return rel;
}

/** Deletes the sqlite file and its WAL sidecars when `fresh` is set. */
export function resetDb(path: string, fresh: boolean): void {
  if (!fresh) return;
  for (const extra of ["", "-wal", "-shm"]) {
    rmSync(`${path}${extra}`, { force: true });
  }
}

export function baseHost(url: string): string {
  try {
    const host = new URL(url).host;
    return host === "" ? "unknown-host" : host;
  } catch {
    return "unknown-host";
  }
}

export function formatSkipped(skipped: { name: string; reason: string }[]): string {
  if (skipped.length === 0) return "skipped: none";
  return `skipped: ${skipped.map((item) => `${item.name}(${item.reason})`).join(" ")}`;
}

export function formatBanner(parts: {
  model: string;
  host: string;
  db: string;
  skipped: { name: string; reason: string }[];
}): string {
  return `${parts.model}  ${parts.host}  ${parts.db}  ${formatSkipped(parts.skipped)}`;
}

export function personaHint(db: string): string {
  return `PERSONA.md is a row in ${db}`;
}

export function commandHead(line: string): string {
  const first = line.trim().split(/\s+/u)[0] ?? "";
  const at = first.indexOf("@");
  return (at >= 0 ? first.slice(0, at) : first).toLowerCase();
}

export function formatPerf(frame: PerfFrame): string {
  const calls = frame.tool_calls ?? 0;
  const iterations = frame.iterations ?? 0;
  return `perf tool_calls=${String(calls)} iterations=${String(iterations)} tokens=${String(frame.tokens.prompt)}/${String(frame.tokens.completion)}`;
}

export function formatStatus(frame: StatusFrame): string {
  const published = frame.published.length === 0 ? "none" : frame.published.join(",");
  const skipped = frame.skipped.length === 0
    ? "none"
    : frame.skipped.map((item) => `${item.name}(${item.reason})`).join(" ");
  return `status published=${published} skipped=${skipped}`;
}

/** One compact view of a brain frame. Null frames are not shown. */
export function renderFrame(frame: BrainFrame, opts: { slug: string; verbose: boolean }): FrameView | null {
  switch (frame.kind) {
    case "typing":
      return { text: "…", overwrite: true, dim: true };
    case "draft":
      return { text: frame.text ?? "", overwrite: true, dim: false };
    case "reply":
    case "push":
      return { text: `${opts.slug}> ${frame.text ?? ""}`, overwrite: false, dim: false };
    case "react":
      return { text: frame.text ?? "", overwrite: false, dim: false };
    case "error":
      return { text: `error: ${frame.text ?? ""}`, overwrite: false, dim: false };
    case "status":
      return { text: formatStatus(frame), overwrite: false, dim: true };
    case "perf":
      return { text: formatPerf(frame), overwrite: false, dim: true };
    case "log":
      if (!opts.verbose) return null;
      return { text: `log ${frame.level} ${frame.message}`, overwrite: false, dim: true };
    default:
      return null;
  }
}

/**
 * Bytes for one view. Overwrite frames paint with CR + clear-line on a
 * terminal and are dropped when stdout is a pipe. Dim uses ANSI only on a
 * terminal. Updates `state.pending` when a draft is still on the line.
 */
export function paint(state: PaintState, view: FrameView, tty: boolean): string {
  if (view.overwrite) {
    if (!tty) return "";
    state.pending = true;
    return `\r\x1b[2K${view.text}`;
  }
  const lead = state.pending ? "\n" : "";
  state.pending = false;
  const text = view.dim && tty ? `\x1b[2m${view.text}\x1b[0m` : view.text;
  return `${lead}${text}\n`;
}

function take(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value == null || value.startsWith("-")) throw new Error(`missing value for ${flag}`);
  return value;
}

function loadDevVars(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function envRecord(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") out[key] = value;
  }
  if ((out.OAUTH_REDIRECT_URI ?? "").trim() === "") out.OAUTH_REDIRECT_URI = LOOPBACK_REDIRECT;
  return out;
}

function rememberSecrets(env: Record<string, string>): void {
  const found: string[] = [];
  const base = (env.LLM_BASE_URL ?? "").trim();
  if (base.length >= 8) found.push(base);
  for (const [name, value] of Object.entries(env)) {
    const trimmed = value.trim();
    if (trimmed.length < 8) continue;
    if (SECRET_NAME.test(name)) found.push(trimmed);
  }
  found.sort((a, b) => b.length - a.length);
  secrets.length = 0;
  for (const value of found) {
    if (!secrets.includes(value)) secrets.push(value);
  }
}

function redact(text: string): string {
  let out = text;
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join("[redacted]");
  }
  return out;
}

function publicError(err: unknown): string {
  const message = err instanceof Error && err.message.trim() !== "" ? err.message : "agent failed";
  return redact(message);
}

function missingLlm(env: Record<string, string>): string[] {
  const missing: string[] = [];
  if ((env.LLM_BASE_URL ?? "").trim() === "") missing.push("LLM_BASE_URL");
  if ((env.LLM_API_KEY ?? "").trim() === "") missing.push("LLM_API_KEY");
  if ((env.LLM_MODEL ?? "").trim() === "") missing.push("LLM_MODEL");
  return missing;
}

type ResolveContext = { parentURL?: string };
type ResolveNext = (specifier: string, context: ResolveContext) => { url: string; shortCircuit?: boolean };
type LoadResult = { format?: string; source?: string; shortCircuit?: boolean };
type LoadNext = (url: string, context: ResolveContext) => LoadResult;

let resolverInstalled = false;

/**
 * Node's type loader does not read tsconfig paths. Brain modules import
 * `@/…` and extensionless `./` files. Register this before importing them.
 */
function installResolver(): void {
  if (resolverInstalled) return;
  resolverInstalled = true;
  const register = (nodeModule as unknown as {
    registerHooks?: (hooks: {
      resolve: (specifier: string, context: ResolveContext, next: ResolveNext) => { url: string; shortCircuit?: boolean };
      load: (url: string, context: ResolveContext, next: LoadNext) => LoadResult;
    }) => void;
  }).registerHooks;
  if (typeof register !== "function") {
    throw new Error("node:module registerHooks is required to load the brain");
  }
  register({
    resolve(specifier, context, next) {
      if (
        specifier.startsWith("node:")
        || specifier.startsWith("file:")
        || (!specifier.startsWith("@/") && !specifier.startsWith("."))
      ) {
        return next(specifier, context);
      }
      const abs = specifier.startsWith("@/")
        ? join(REPO_ROOT, specifier.slice(2))
        : relativeFile(specifier, context.parentURL);
      if (abs == null) return next(specifier, context);
      const file = resolveFile(abs);
      if (file == null) return next(specifier, context);
      return { url: pathToFileURL(file).href, shortCircuit: true };
    },
    load(url, context, next) {
      if (url.startsWith("file:") && url.endsWith(".json")) {
        return { format: "json", source: readFileSync(fileURLToPath(url), "utf8"), shortCircuit: true };
      }
      return next(url, context);
    },
  });
}

function relativeFile(specifier: string, parentURL: string | undefined): string | null {
  if (parentURL == null || !parentURL.startsWith("file:")) return null;
  return fileURLToPath(new URL(specifier, parentURL));
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function resolveFile(specPath: string): string | null {
  if (isFile(specPath)) return specPath;
  const base = specPath.endsWith(".js") ? specPath.slice(0, -3) : specPath;
  const list = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.json`,
    join(base, "index.ts"),
    join(base, "index.js"),
  ];
  for (const path of list) {
    if (isFile(path)) return path;
  }
  return null;
}

function loadTokenKey(sql: Sql, ok: (value: string) => boolean, mint: () => string): string {
  sql.exec("CREATE TABLE IF NOT EXISTS agent_repl (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  const row = sql.one("SELECT v FROM agent_repl WHERE k = ?", "token.key");
  const stored = row?.v;
  if (typeof stored === "string" && ok(stored)) return stored;
  const key = mint();
  sql.exec(
    "INSERT INTO agent_repl (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
    "token.key",
    key,
  );
  return key;
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry == null || entry === "") return false;
  return resolve(entry) === fileURLToPath(import.meta.url);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadDevVars(join(REPO_ROOT, ".dev.vars"));
  const env = envRecord();
  rememberSecrets(env);
  const missing = missingLlm(env);
  if (missing.length > 0) {
    throw new Error(`missing ${missing.join(", ")}. Set them in .dev.vars or the environment`);
  }
  installResolver();

  const [{ systemClock }, { makeLogger }, { nodeSql }, tokens, personaMod, { openaiProvider }, { allPlugins }, { createBrain }] = await Promise.all([
    import("../brain/core/clock.ts"),
    import("../brain/core/log.ts"),
    import("../brain/core/sql.ts"),
    import("../brain/tools/tokens.ts"),
    import("../brain/persona/index.ts"),
    import("../brain/provider/index.ts"),
    import("../brain/plugins/index.ts"),
    import("../brain/agent/brain.ts"),
  ]);
  const { DatabaseSync } = await import("node:sqlite");

  const abs = dbPath(args.slug, args.db, process.cwd());
  const shown = displayDb(abs, process.cwd());
  resetDb(abs, args.fresh);
  mkdirSync(dirname(abs), { recursive: true });
  const db = new DatabaseSync(abs);
  let closed = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closeDb = (): void => {
    if (closed) return;
    closed = true;
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    db.close();
  };

  const sql = nodeSql(db as unknown as NodeDatabase);
  const quiet = makeLogger(() => undefined, () => Date.now(), { slug: args.slug });
  const store = new personaMod.PersonaStore(sql, systemClock("UTC"), quiet, args.slug);
  store.importLegacy(PERSONA_TEMPLATE);
  const personaText = store.read(personaMod.filePersona) ?? "";
  const zone = personaMod.resolveTimezone(personaText, env.CRON_TZ ?? "").name;
  const clock = systemClock(zone);
  const log = makeLogger(() => undefined, () => clock.now(), { slug: args.slug });
  const parts: { name: string; text: string }[] = [];
  for (const file of store.list()) {
    if (file.name === personaMod.fileSelf) continue;
    parts.push({ name: file.name, text: file.text });
  }

  const provider = openaiProvider({
    baseUrl: (env.LLM_BASE_URL ?? "").trim(),
    apiKey: (env.LLM_API_KEY ?? "").trim(),
    model: (env.LLM_MODEL ?? "").trim(),
    ...tokenOptions(env),
  });
  const brain = createBrain({
    sql,
    clock,
    log,
    provider,
    plugins: [...allPlugins],
    tokens: new tokens.AesTokenStore(sql, loadTokenKey(sql, tokens.tokenKeyOk, tokens.mintTokenKey), clock),
    fetch: globalThis.fetch,
    env,
    persona: parts,
    slug: args.slug,
  });

  const tty = process.stdout.isTTY === true;
  const paintState: PaintState = { pending: false };
  const screen = {
    show(view: FrameView | null): void {
      if (view == null) return;
      const painted = paint(paintState, { ...view, text: redact(view.text) }, tty);
      if (painted !== "") process.stdout.write(painted);
    },
    write(text: string): void {
      if (paintState.pending) {
        process.stdout.write("\n");
        paintState.pending = false;
      }
      process.stdout.write(redact(text.endsWith("\n") ? text : `${text}\n`));
    },
  };

  const frameOpts = { slug: args.slug, verbose: args.verbose };
  let busy = false;
  let rl: ReturnType<typeof createInterface> | undefined;
  const emit = (frame: BrainFrame): void => {
    screen.show(renderFrame(frame, frameOpts));
    if (!busy && rl != null && frame.kind !== "typing" && frame.kind !== "draft") rl.prompt(true);
  };

  let tail = Promise.resolve();
  const enqueue = (work: () => Promise<void>): Promise<void> => {
    const run = tail.then(() => (stopped ? undefined : work()), () => (stopped ? undefined : work()));
    tail = run.then(() => undefined, () => undefined);
    return run;
  };

  const arm = (at: number | null): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (stopped || at == null || !Number.isFinite(at)) return;
    const delay = at - Date.now();
    const wait = delay <= 0 ? 0 : Math.min(delay, MAX_TIMER);
    timer = setTimeout(() => {
      void enqueue(() => fire(false)).catch((err: unknown) => {
        screen.write(`error: ${publicError(err)}`);
      });
    }, wait);
  };

  const fire = async (force: boolean): Promise<void> => {
    if (stopped) return;
    if (!force) {
      const due = brain.nextAlarm();
      if (due == null || due > Date.now() + 500) {
        arm(due);
        return;
      }
    }
    const next = await brain.alarm(emit);
    const follow = next ?? brain.nextAlarm();
    if (follow != null && follow <= Date.now()) {
      arm(Date.now() + 1000);
      return;
    }
    arm(follow);
  };

  const startup: BrainFrame[] = [];
  await brain.announce((frame) => {
    startup.push(frame);
  });
  const status = startup.find((frame): frame is StatusFrame => frame.kind === "status");
  screen.write(formatBanner({
    model: (env.LLM_MODEL ?? "").trim(),
    host: baseHost((env.LLM_BASE_URL ?? "").trim()),
    db: shown,
    skipped: status?.skipped ?? [],
  }));
  if (args.verbose) {
    for (const frame of startup) {
      if (frame.kind === "log") screen.show(renderFrame(frame, frameOpts));
    }
  }
  arm(brain.nextAlarm());

  let turns = 0;
  const turn = async (line: string): Promise<void> => {
    const head = commandHead(line);
    if (head === "/alarm") {
      await fire(true);
      return;
    }
    if (head === "/persona") {
      const text = store.read(personaMod.filePersona) ?? "";
      const body = text === "" || text.endsWith("\n") ? text : `${text}\n`;
      screen.write(`${body}${personaHint(shown)}`);
      return;
    }
    busy = true;
    try {
      turns += 1;
      const inbound: Inbound = {
        kind: "inbound",
        user_id: DEV_USER,
        id: `repl-${String(turns)}`,
        text: line,
        context: {
          tz: clock.zone,
          at: new Date(clock.now()).toISOString(),
          surface: "browser",
        },
      };
      await brain.handleInbound(inbound, emit);
      if (head === "/auth") screen.write(AUTH_REPL_NOTE);
    } finally {
      busy = false;
      arm(brain.nextAlarm());
    }
  };

  const onSigint = (): void => {
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", onSigint);

  try {
    const piped = process.stdin.isTTY !== true;
    if (piped || args.once) {
      if (!piped && args.once) {
        const onceRl = createInterface({ input: process.stdin, output: process.stdout, prompt: "you> " });
        rl = onceRl;
        const line = await new Promise<string>((resolveLine) => {
          onceRl.once("line", (value: string) => resolveLine(value));
          onceRl.prompt();
        });
        rl = undefined;
        onceRl.close();
        if (line.trim() !== "") await enqueue(() => turn(line));
      } else {
        const text = readFileSync(0, "utf8");
        for (const line of text.split(/\r?\n/u)) {
          if (line.trim() === "") continue;
          await enqueue(() => turn(line));
        }
      }
      return;
    }

    const interactive = createInterface({ input: process.stdin, output: process.stdout, prompt: "you> " });
    rl = interactive;
    interactive.on("SIGINT", onSigint);
    interactive.prompt();
    for await (const line of interactive) {
      if (line.trim() !== "") {
        try {
          await enqueue(() => turn(line));
        } catch (err: unknown) {
          screen.write(`error: ${publicError(err)}`);
        }
      }
      interactive.prompt();
    }
  } finally {
    process.off("SIGINT", onSigint);
    closeDb();
  }
}

function tokenOptions(env: Record<string, string>): { maxTokens?: number; reasoningEffort?: string; systemFold?: "auto" | "one" | "many" } {
  const out: { maxTokens?: number; reasoningEffort?: string; systemFold?: "auto" | "one" | "many" } = {};
  const maxRaw = (env.LLM_MAX_TOKENS ?? "").trim();
  const maxTokens = maxRaw === "" ? undefined : Number(maxRaw);
  if (maxTokens !== undefined && Number.isFinite(maxTokens) && maxTokens > 0) out.maxTokens = Math.floor(maxTokens);
  const effort = (env.LLM_REASONING_EFFORT ?? "").trim();
  if (effort !== "") out.reasoningEffort = effort;
  const fold = (env.LLM_SYSTEM_FOLD ?? "").trim();
  if (fold === "auto" || fold === "one" || fold === "many") out.systemFold = fold;
  return out;
}

if (invokedDirectly()) {
  main().catch((err: unknown) => {
    process.stderr.write(`${publicError(err)}\n`);
    process.exitCode = 1;
  });
}
