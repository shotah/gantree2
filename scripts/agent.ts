#!/usr/bin/env node
/**
 * Run a real agent against `npm run dev` — the Go harness as a process on this
 * box, no Docker, dialing the Agent DO the same way a container does.
 *
 *   npm run dev                       # terminal 1
 *   npm run agent                     # terminal 2: one harness per agent on the board
 *   npm run agent -- kit              # just Kit
 *   npm run agent -- --build kit      # rebuild harness/bin/gantry first
 *   npm run agent -- --base=http://127.0.0.1:3000 kit
 *
 * Needs `GANTREE_DEV_USER` in `.dev.vars` (the loopback dev door is how this
 * script is an admin), and `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` there too:
 * the harness reads them before the `config` frame arrives, and the Agent DO
 * lays the same house values under each agent's own keys on that frame.
 *
 * Per agent: the room bearer comes from `AGENT_BEARERS` or the loopback-only
 * `GET /api/agents/:slug/bearer`; the dev user is put on the room list so the
 * chat opens; `gantry run` starts with `CHANNEL=chat` and `SNAPSHOT=true`, so
 * persona, mcp.toml, and the agent's keys arrive on the socket and gantry.db
 * snapshots to the dev server's R2 like it would in the cloud. State lives in
 * `local/run/<slug>/` (git-ignored) between runs. A harness that exits is
 * restarted with backoff; Ctrl-C stops them all.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { houseEnv, LLM_KEYS } from "../lib/agents/house.ts";
import type { RoomUser } from "../lib/chat/allow.ts";
import { bearerFor, devIdentityFrom, parseDevVars, REPO_ROOT, type DevIdentity } from "./seed.ts";

export const HARNESS_DIR = join(REPO_ROOT, "harness");
export const RUN_DIR = join(REPO_ROOT, "local", "run");
export const PERSONA_SEED = join(HARNESS_DIR, "examples", "persona", "PERSONA.example.md");
export const DEFAULT_BASE = "http://127.0.0.1:3000";

export type AgentArgs = { help: boolean; build: boolean; base: string; slugs: string[] };

export function parseAgentArgs(argv: readonly string[]): AgentArgs {
  const out: AgentArgs = { help: false, build: false, base: DEFAULT_BASE, slugs: [] };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--build") {
      out.build = true;
    } else if (arg.startsWith("--base=")) {
      const value = arg.slice("--base=".length);
      if (!value) {
        throw new Error("usage: agent.ts [--build] [--base=url] [slug ...]");
      }
      out.base = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown arg ${arg}`);
    } else {
      out.slugs.push(arg.trim().toLowerCase());
    }
  }
  return out;
}

/** Default binary path; `GANTRY_BIN` overrides. */
export function gantryBin(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const set = env.GANTRY_BIN?.trim();
  return set || join(HARNESS_DIR, "bin", process.platform === "win32" ? "gantry.exe" : "gantry");
}

/** `LLM_*` the harness refuses to boot without, missing from `.dev.vars`. */
export function missingLlm(vars: ReadonlyMap<string, string>): string[] {
  return LLM_KEYS.filter((key) => !vars.get(key)?.trim());
}

export function socketUrl(base: string, slug: string): string {
  const url = new URL(`/ws/${slug}`, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = "";
  return url.toString();
}

export type RunDirs = { root: string; data: string; persona: string; mcp: string };

export function runDirs(slug: string, runRoot = RUN_DIR): RunDirs {
  const root = join(runRoot, slug);
  return { root, data: join(root, "data"), persona: join(root, "persona"), mcp: join(root, "mcp.toml") };
}

/**
 * Process env for one harness. The dial-back the container gets, plus the
 * house keys (the Go side wants `LLM_*` at boot; the config frame then lays
 * the agent's own on top), plus local paths. `harness/bin` leads `PATH` so
 * plugins built there are found by `mcp.toml` commands.
 */
export function harnessEnv(input: {
  vars: ReadonlyMap<string, string>;
  base: string;
  slug: string;
  bearer: string;
  dirs: RunDirs;
  path: string | undefined;
}): Record<string, string> {
  const house = houseEnv(Object.fromEntries(input.vars));
  return {
    ...house,
    CHANNEL: "chat",
    CHAT_MAILBOX_URL: socketUrl(input.base, input.slug),
    CHAT_BEARER: input.bearer,
    SNAPSHOT: "true",
    SNAPSHOT_INTERVAL: "5m",
    DATA_DIR: input.dirs.data,
    PERSONA_DIR: input.dirs.persona,
    MCP_MANIFEST: input.dirs.mcp,
    PATH: [join(HARNESS_DIR, "bin"), input.path ?? ""].filter(Boolean).join(delimiter),
  };
}

export function onRoom(users: readonly RoomUser[], me: DevIdentity): boolean {
  return users.some((user) => user.sub === me.sub || (Boolean(user.email) && user.email === me.email.toLowerCase()));
}

export function withMe(users: readonly RoomUser[], me: DevIdentity): RoomUser[] {
  return onRoom(users, me) ? [...users] : [...users, { sub: me.sub, email: me.email }];
}

/** 2 s, 4 s, 8 s … capped at 30 s. */
export function backoffMs(attempt: number): number {
  return Math.min(30_000, 2000 * 2 ** Math.max(0, attempt));
}

export function slugsFromBoard(body: unknown): string[] {
  if (!body || typeof body !== "object" || !("agents" in body) || !Array.isArray(body.agents)) {
    return [];
  }
  const out: string[] = [];
  for (const item of body.agents as unknown[]) {
    if (item && typeof item === "object" && "slug" in item && typeof item.slug === "string") {
      out.push(item.slug);
    }
  }
  return out;
}

export function prefixLines(slug: string, chunk: string): string {
  return chunk
    .split("\n")
    .filter((line, index, all) => line.length > 0 || index < all.length - 1)
    .map((line) => `[${slug}] ${line}\n`)
    .join("");
}

/** Make the run dir the harness expects: writable data, a persona to load, a manifest file. */
export function prepareRunDir(dirs: RunDirs, personaSeed = PERSONA_SEED): void {
  mkdirSync(dirs.data, { recursive: true });
  mkdirSync(dirs.persona, { recursive: true });
  const persona = join(dirs.persona, "PERSONA.md");
  if (!existsSync(persona) && existsSync(personaSeed)) {
    copyFileSync(personaSeed, persona);
  }
  if (!existsSync(dirs.mcp)) {
    writeFileSync(dirs.mcp, "", { mode: 0o600 });
  }
}

type HttpResult = { status: number; body: unknown };

async function call(base: string, path: string, method = "GET", body?: unknown): Promise<HttpResult> {
  const headers = new Headers();
  if (body !== undefined) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(new URL(path, base), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }
  return { status: res.status, body: parsed };
}

function errorCode(body: unknown): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return "request_failed";
}

function identityFromMe(body: unknown): DevIdentity | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const sub = "sub" in body && typeof body.sub === "string" ? body.sub : "";
  const email = "email" in body && typeof body.email === "string" ? body.email : "";
  return sub && email ? { sub, email } : null;
}

function usersFrom(body: unknown): RoomUser[] {
  if (!body || typeof body !== "object" || !("users" in body) || !Array.isArray(body.users)) {
    return [];
  }
  return body.users as RoomUser[];
}

async function resolveBearer(base: string, vars: ReadonlyMap<string, string>, slug: string): Promise<string> {
  const fromVars = bearerFor(vars.get("AGENT_BEARERS"), slug);
  if (fromVars) {
    return fromVars;
  }
  const res = await call(base, `/api/agents/${slug}/bearer`);
  if (res.status !== 200) {
    throw new Error(`GET /api/agents/${slug}/bearer → ${res.status} ${errorCode(res.body)} (is the agent on the board, and GANTREE_DEV_USER set?)`);
  }
  const bearer = res.body && typeof res.body === "object" && "bearer" in res.body ? res.body.bearer : null;
  if (typeof bearer !== "string" || !bearer) {
    throw new Error(`no bearer for ${slug}`);
  }
  return bearer;
}

async function admitMe(base: string, slug: string, me: DevIdentity): Promise<boolean> {
  const listed = await call(base, `/api/agents/${slug}/users`);
  if (listed.status !== 200) {
    throw new Error(`GET /api/agents/${slug}/users → ${listed.status} ${errorCode(listed.body)}`);
  }
  const users = usersFrom(listed.body);
  if (onRoom(users, me)) {
    return false;
  }
  const put = await call(base, `/api/agents/${slug}/users`, "PUT", { users: withMe(users, me) });
  if (put.status !== 200) {
    throw new Error(`PUT /api/agents/${slug}/users → ${put.status} ${errorCode(put.body)}`);
  }
  return true;
}

export function buildGantry(bin: string, out: NodeJS.WritableStream = process.stdout): void {
  out.write(`building ${bin} (go build ./cmd/gantry)\n`);
  const result = spawnSync("go", ["build", "-trimpath", "-o", bin, "./cmd/gantry"], {
    cwd: HARNESS_DIR,
    stdio: "inherit",
    env: { ...process.env, CGO_ENABLED: process.env.CGO_ENABLED ?? "0" },
  });
  if (result.error) {
    throw new Error(`go build failed: ${result.error.message} (is Go on PATH? see docs/install.md)`);
  }
  if (result.status !== 0) {
    throw new Error(`go build exited ${result.status ?? "?"}`);
  }
}

/** The slice of ChildProcess stopAll needs; tests hand in a fake. */
type Stoppable = {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill(signal: NodeJS.Signals): boolean;
  once(event: "exit", listener: () => void): unknown;
};
type Running = { slug: string; child: Stoppable | null; stopped: boolean };

/** How long SIGTERM gets to flush the snapshot before SIGKILL. */
export const STOP_WAIT_MS = 10_000;

function alive(child: Stoppable): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function exited(child: Stoppable): Promise<void> {
  if (!alive(child)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
  });
}

/**
 * SIGTERM every harness, wait up to waitMs for them to publish their snapshot
 * and exit, then SIGKILL whatever is left. Returns the slugs that needed SIGKILL.
 */
export async function stopAll(running: readonly Running[], waitMs = STOP_WAIT_MS): Promise<string[]> {
  const live: { slug: string; child: Stoppable }[] = [];
  for (const run of running) {
    run.stopped = true;
    if (run.child && alive(run.child)) {
      live.push({ slug: run.slug, child: run.child });
      run.child.kill("SIGTERM");
    }
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), waitMs);
  });
  const done = Promise.all(live.map((run) => exited(run.child))).then((): "done" => "done");
  const outcome = await Promise.race([done, timeout]);
  clearTimeout(timer);
  const killed: string[] = [];
  if (outcome === "timeout") {
    for (const run of live) {
      if (alive(run.child)) {
        run.child.kill("SIGKILL");
        killed.push(run.slug);
      }
    }
  }
  return killed;
}

function supervise(slug: string, bin: string, env: Record<string, string>, out: NodeJS.WritableStream): Running {
  const state: Running = { slug, child: null, stopped: false };
  let attempt = 0;
  const start = (): void => {
    if (state.stopped) {
      return;
    }
    // Vinext's types make NODE_ENV a required key of ProcessEnv; the harness env is just strings.
    const child: ChildProcess = spawn(bin, ["run"], { env: env as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
    state.child = child;
    const startedAt = Date.now();
    child.stdout?.on("data", (chunk: Buffer) => out.write(prefixLines(slug, chunk.toString())));
    child.stderr?.on("data", (chunk: Buffer) => out.write(prefixLines(slug, chunk.toString())));
    child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      state.child = null;
      if (state.stopped) {
        return;
      }
      // Ran for a while: the next crash starts the backoff over.
      attempt = Date.now() - startedAt > 60_000 ? 0 : attempt + 1;
      const wait = backoffMs(attempt);
      out.write(`[${slug}] exited (${signal ?? code ?? "?"}); restarting in ${wait / 1000}s\n`);
      setTimeout(start, wait);
    });
  };
  start();
  return state;
}

export async function main(argv: readonly string[]): Promise<void> {
  const args = parseAgentArgs(argv);
  if (args.help) {
    process.stdout.write("npm run agent [-- --build] [-- --base=http://127.0.0.1:3000] [-- slug ...]\n");
    return;
  }
  const varsPath = join(REPO_ROOT, ".dev.vars");
  if (!existsSync(varsPath)) {
    throw new Error(".dev.vars not found: cp .dev.vars.example .dev.vars and fill it (docs/install.md)");
  }
  const vars = parseDevVars(readFileSync(varsPath, "utf8"));
  if (!devIdentityFrom(vars.get("GANTREE_DEV_USER"))) {
    throw new Error("GANTREE_DEV_USER must be set in .dev.vars (sub:email): the loopback dev door is how this script signs in");
  }
  const missing = missingLlm(vars);
  if (missing.length > 0) {
    throw new Error(`${missing.join(", ")} missing from .dev.vars: the harness needs LLM_BASE_URL, LLM_API_KEY, LLM_MODEL before the config frame`);
  }

  const ping = await call(args.base, "/api/auth/me");
  if (ping.status !== 200) {
    throw new Error(`GET /api/auth/me → ${ping.status} ${errorCode(ping.body)} (is npm run dev up on ${args.base}?)`);
  }
  const me = identityFromMe(ping.body);
  if (!me) {
    throw new Error("signed-in user has no sub and email");
  }

  let slugs = args.slugs;
  if (slugs.length === 0) {
    const board = await call(args.base, "/api/agents");
    if (board.status !== 200) {
      throw new Error(`GET /api/agents → ${board.status} ${errorCode(board.body)}`);
    }
    slugs = slugsFromBoard(board.body);
    if (slugs.length === 0) {
      throw new Error(`no agents on the board: create one at ${args.base}/agents/new, then run this again`);
    }
  }

  const bin = gantryBin();
  if (args.build || !existsSync(bin)) {
    buildGantry(bin);
  }

  const running: Running[] = [];
  for (const slug of slugs) {
    const bearer = await resolveBearer(args.base, vars, slug);
    if (await admitMe(args.base, slug, me)) {
      process.stdout.write(`[${slug}] added ${me.email} to the room\n`);
    }
    const dirs = runDirs(slug);
    prepareRunDir(dirs);
    const env = harnessEnv({ vars, base: args.base, slug, bearer, dirs, path: process.env.PATH });
    process.stdout.write(`[${slug}] gantry run → ${env.CHAT_MAILBOX_URL}  state ${dirs.root}\n`);
    running.push(supervise(slug, bin, env, process.stdout));
  }
  process.stdout.write(`chat: ${slugs.map((slug) => `${args.base}/chat/${slug}`).join("  ")}\n`);

  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  process.stdout.write("\nstopping: waiting for snapshots\n");
  const killed = await stopAll(running);
  for (const slug of killed) {
    process.stdout.write(`[${slug}] did not stop in ${STOP_WAIT_MS / 1000}s; killed\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : "agent failed";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
