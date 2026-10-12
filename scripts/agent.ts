#!/usr/bin/env node
/**
 * Local chat against the real Agent DO and house LLM keys.
 *
 *   npm run agent
 *   npm run agent -- --slug ada --port 3000
 *
 * Loads `.dev.vars` like seed (existing environment wins; values are never
 * printed). Starts or reuses `npm run dev`, ensures the agent exists, restarts
 * the brain, prints the chat URL. Open that URL in the browser to talk.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Wire shape for `GET/PUT /api/agents/:slug/users` (launcher-only parse). */
export type RoomUser = { sub?: string; email?: string };

const SLUG = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/;
const SECRET_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|BEARER)/i;
const HEALTH_PATH = "/api/health";
const WAIT_MS = 90_000;
const POLL_MS = 500;

export const AUTH_HINT = [
  "Agent API returned 401 or 403.",
  "Set GANTREE_DEV_USER in .dev.vars (loopback only) and list that identity in GANTREE_ADMINS.",
  "The dev server is still running.",
].join(" ");

export type AgentArgs = {
  slug: string;
  port: number;
};

export type BannerParts = {
  slug: string;
  model: string;
  host: string;
  chatUrl: string;
  state?: string;
  published?: string[];
};

export type EnsureDecision = "exists" | "missing" | "auth" | "fail";
export type CreateDecision = "created" | "present" | "auth" | "fail";
export type RestartDecision = "ok" | "auth" | "fail";

export function parseArgs(argv: string[]): AgentArgs {
  let slug = "kit";
  let port = 3000;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--") continue;
    if (arg === "--slug" || arg.startsWith("--slug=")) {
      if (arg === "--slug") {
        i += 1;
        slug = take(argv, i, "--slug");
      } else {
        slug = arg.slice("--slug=".length);
      }
      continue;
    }
    if (arg === "--port" || arg.startsWith("--port=")) {
      if (arg === "--port") {
        i += 1;
        const raw = take(argv, i, "--port");
        port = parsePort(raw);
      } else {
        port = parsePort(arg.slice("--port=".length));
      }
      continue;
    }
    if (arg === "--db" || arg.startsWith("--db=") || arg === "--fresh" || arg === "--verbose" || arg === "--once") {
      const name = arg.startsWith("--") ? arg.split("=")[0] ?? arg : arg;
      throw new Error(`unknown flag ${name}`);
    }
    if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}`);
    throw new Error(`unexpected argument ${arg}`);
  }
  if (!SLUG.test(slug)) throw new Error(`bad slug ${JSON.stringify(slug)}`);
  return { slug, port };
}

function take(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value == null || value.startsWith("-")) throw new Error(`missing value for ${flag}`);
  return value;
}

function parsePort(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`bad port ${JSON.stringify(raw)}`);
  return n;
}

/** Parse `.dev.vars` assignments (no export prefix required). */
export function parseDevVars(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

/** Overlay file keys onto `base`; existing keys in `base` win. */
export function applyDevVars(text: string, base: Record<string, string>): Record<string, string> {
  const out = { ...base };
  for (const [key, value] of parseDevVars(text)) {
    if (out[key] === undefined) out[key] = value;
  }
  return out;
}

export function loadDevVars(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const [key, value] of parseDevVars(text)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function envRecord(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export function missingLlm(env: Record<string, string>): string[] {
  const missing: string[] = [];
  if ((env.LLM_BASE_URL ?? "").trim() === "") missing.push("LLM_BASE_URL");
  if ((env.LLM_API_KEY ?? "").trim() === "") missing.push("LLM_API_KEY");
  if ((env.LLM_MODEL ?? "").trim() === "") missing.push("LLM_MODEL");
  return missing;
}

export function collectSecrets(env: Record<string, string>): string[] {
  const found: string[] = [];
  const base = (env.LLM_BASE_URL ?? "").trim();
  if (base.length >= 8) found.push(base);
  for (const [name, value] of Object.entries(env)) {
    const trimmed = value.trim();
    if (trimmed.length < 8) continue;
    if (SECRET_NAME.test(name)) found.push(trimmed);
  }
  found.sort((a, b) => b.length - a.length);
  const unique: string[] = [];
  for (const value of found) {
    if (!unique.includes(value)) unique.push(value);
  }
  return unique;
}

export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (out.includes(secret)) out = out.split(secret).join("[redacted]");
  }
  return out;
}

export function baseHost(url: string): string {
  try {
    const host = new URL(url).host;
    return host === "" ? "unknown-host" : host;
  } catch {
    return "unknown-host";
  }
}

export function chatUrl(port: number, slug: string): string {
  return `http://127.0.0.1:${port}/chat/${slug}`;
}

export function formatPublished(names: string[] | undefined): string {
  if (names == null || names.length === 0) return "none";
  return names.join(",");
}

export function formatBanner(parts: BannerParts): string {
  const bits = [
    parts.slug,
    parts.model,
    parts.host,
    parts.chatUrl,
  ];
  if (parts.state != null && parts.state !== "") bits.push(`state=${parts.state}`);
  if (parts.published != null) bits.push(`published=${formatPublished(parts.published)}`);
  return bits.join("  ");
}

export function isGantreeHealth(status: number, body: unknown): boolean {
  if (status !== 200) return false;
  if (body == null || typeof body !== "object") return false;
  return (body as { ok?: unknown }).ok === true;
}

export type HealthProbe = {
  kind: "gantree" | "busy" | "down";
  status: number;
  body: unknown;
};

export function classifyHealthProbe(status: number, body: unknown, connError: boolean): HealthProbe {
  if (connError) return { kind: "down", status: 0, body: null };
  if (isGantreeHealth(status, body)) return { kind: "gantree", status, body };
  return { kind: "busy", status, body };
}

/** Fetch failed before an HTTP response — keep polling; not a foreign server on the port. */
export function isHealthFetchDown(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return true;
    const cause = "cause" in err ? err.cause : err;
    if (cause != null && typeof cause === "object" && "code" in cause) {
      const code = (cause as { code?: string }).code;
      if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ECONNRESET") return true;
    }
  }
  return true;
}

export function decideEnsureAgentGet(status: number): EnsureDecision {
  if (status === 200) return "exists";
  if (status === 404) return "missing";
  if (status === 401 || status === 403) return "auth";
  return "fail";
}

export function decideCreateAgent(status: number): CreateDecision {
  if (status === 201) return "created";
  if (status === 409) return "present";
  if (status === 401 || status === 403) return "auth";
  return "fail";
}

export function decideRestartAgent(status: number): RestartDecision {
  if (status === 200) return "ok";
  if (status === 401 || status === 403) return "auth";
  return "fail";
}

export type DevRoomIdentity = { sub: string; email?: string };

export type RoomUsersPatch = { users: RoomUser[]; added: boolean };

/** Loopback dev identity from `GET /api/auth/me` (200, non-empty `sub`). */
export function devIdentityFromMe(body: unknown): DevRoomIdentity | null {
  if (body == null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.sub !== "string" || record.sub.trim() === "") return null;
  const sub = record.sub.trim();
  const emailRaw = record.email;
  if (typeof emailRaw === "string" && emailRaw.trim() !== "") {
    return { sub, email: emailRaw.trim() };
  }
  return { sub };
}

function parseRoomUserRow(raw: unknown): RoomUser | null {
  if (raw == null || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const out: RoomUser = {};
  const sub = typeof row.sub === "string" ? row.sub.trim() : "";
  const email = typeof row.email === "string" ? row.email.trim() : "";
  if (sub !== "") out.sub = sub;
  if (email !== "") out.email = email;
  if (out.sub === undefined && out.email === undefined) return null;
  return out;
}

export function parseRoomUsersList(raw: unknown): RoomUser[] {
  if (!Array.isArray(raw)) return [];
  const out: RoomUser[] = [];
  for (const item of raw) {
    const user = parseRoomUserRow(item);
    if (user != null) out.push(user);
  }
  return out;
}

export function roomUsersFromBody(body: unknown): RoomUser[] {
  if (body == null || typeof body !== "object") return [];
  return parseRoomUsersList((body as { users?: unknown }).users);
}

function rowSub(row: RoomUser): string {
  return (row.sub ?? "").trim();
}

/**
 * Append the dev user to the room list when missing. Keeps every existing row.
 * Empty `dev.sub` does not add. Omits `email` on the new row when blank.
 */
export function roomWithDev(users: readonly RoomUser[], dev: DevRoomIdentity): RoomUsersPatch {
  const sub = dev.sub.trim();
  const kept = users.map((row) => ({ ...row }));
  if (sub === "") return { users: kept, added: false };
  if (kept.some((row) => rowSub(row) === sub)) return { users: kept, added: false };
  const next: RoomUser = { sub };
  const email = dev.email?.trim() ?? "";
  if (email !== "") next.email = email;
  return { users: [...kept, next], added: true };
}

export function decidePutRoomUsers(status: number): RestartDecision {
  if (status === 200) return "ok";
  if (status === 401 || status === 403) return "auth";
  return "fail";
}

export function statusFromBody(body: unknown): { state?: string; published?: string[] } {
  if (body == null || typeof body !== "object") return {};
  const row = body as { state?: unknown; published?: unknown };
  const state = typeof row.state === "string" ? row.state : undefined;
  let published: string[] | undefined;
  if (Array.isArray(row.published)) {
    published = row.published.filter((item): item is string => typeof item === "string");
  }
  return { state, published };
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry == null || entry === "") return false;
  return resolve(entry) === fileURLToPath(import.meta.url);
}

function publicError(err: unknown, secrets: readonly string[]): string {
  const message = err instanceof Error && err.message.trim() !== "" ? err.message : "agent failed";
  return redact(message, secrets);
}

async function fetchHealth(base: string): Promise<HealthProbe> {
  const url = new URL(HEALTH_PATH, base);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = null;
      }
    }
    return classifyHealthProbe(res.status, body, false);
  } catch (err: unknown) {
    if (!isHealthFetchDown(err)) {
      return classifyHealthProbe(0, null, false);
    }
    return classifyHealthProbe(0, null, true);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

export type HealthPollResult = { ok: boolean; last: HealthProbe | null };

/** Poll until gantree health, deadline, or `alive` is false. Non-gantree HTTP responses keep polling. */
export async function pollGantreeHealth(
  probe: () => Promise<HealthProbe>,
  alive: () => boolean,
  deadlineMs: number,
  pollMs: number = POLL_MS,
): Promise<HealthPollResult> {
  const end = Date.now() + deadlineMs;
  let last: HealthProbe | null = null;
  while (Date.now() < end) {
    if (!alive()) return { ok: false, last };
    const result = await probe();
    last = result;
    if (result.kind === "gantree") return { ok: true, last };
    await sleep(pollMs);
  }
  return { ok: false, last };
}

export async function waitForGantreeHealth(
  base: string,
  deadlineMs: number,
  probe: (base: string) => Promise<HealthProbe> = fetchHealth,
): Promise<boolean> {
  const { ok } = await pollGantreeHealth(() => probe(base), () => true, deadlineMs);
  return ok;
}

function childAlive(child: ChildProcess): boolean {
  return child.exitCode == null && child.signalCode == null;
}

async function waitForHealthAfterSpawn(child: ChildProcess, base: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const finish = (err?: Error): void => {
      child.off("error", onError);
      child.off("exit", onExit);
      if (err) reject(err);
      else resolve();
    };

    const onError = (err: Error): void => {
      finish(err);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (code != null && code !== 0) process.exitCode = code;
      void signal;
      finish(new Error("dev server exited before health was ready"));
    };

    child.once("error", onError);
    child.once("exit", onExit);

    void pollGantreeHealth(
      () => fetchHealth(base),
      () => childAlive(child),
      WAIT_MS,
    ).then(({ ok, last }) => {
      if (ok) {
        finish();
        return;
      }
      if (!childAlive(child)) {
        const code = child.exitCode;
        if (code != null && code !== 0) process.exitCode = code;
        finish(new Error("dev server exited before health was ready"));
        return;
      }
      if (last?.kind === "busy") {
        finish(new Error(`port ${port} is in use but /api/health is not gantree`));
        return;
      }
      finish(new Error(`timed out waiting for ${HEALTH_PATH}`));
    });
  });
}

type HttpResult = { status: number; body: unknown };

async function apiCall(base: string, method: string, path: string, body?: unknown): Promise<HttpResult> {
  const headers = new Headers();
  let init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init = { ...init, body: JSON.stringify(body) };
  }
  const res = await fetch(new URL(path, base), init);
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

function viteBin(): string {
  return join(REPO_ROOT, "node_modules", ".bin", "vite");
}

function spawnDev(port: number): ChildProcess {
  const bin = viteBin();
  return spawn(bin, ["dev", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  });
}

type EnsureOutcome
  = | { ok: true; status: ReturnType<typeof statusFromBody> }
    | { ok: false; auth: true }
    | { ok: false; auth: false };

async function ensureDevInRoom(base: string, slug: string): Promise<{ auth: true } | { auth: false }> {
  const me = await apiCall(base, "GET", "/api/auth/me");
  if (me.status === 401 || me.status === 403) return { auth: true };
  if (me.status !== 200) throw new Error(`GET /api/auth/me → ${me.status}`);
  const dev = devIdentityFromMe(me.body);
  if (dev == null) throw new Error("GET /api/auth/me → missing sub");

  const listed = await apiCall(base, "GET", `/api/agents/${slug}/users`);
  if (listed.status === 401 || listed.status === 403) return { auth: true };
  if (listed.status !== 200) throw new Error(`GET /api/agents/${slug}/users → ${listed.status}`);

  const patch = roomWithDev(roomUsersFromBody(listed.body), dev);
  if (!patch.added) return { auth: false };

  const put = await apiCall(base, "PUT", `/api/agents/${slug}/users`, { users: patch.users });
  switch (decidePutRoomUsers(put.status)) {
    case "ok":
      return { auth: false };
    case "auth":
      return { auth: true };
    case "fail":
      throw new Error(`PUT /api/agents/${slug}/users → ${put.status}`);
  }
}

async function ensureAgent(base: string, slug: string): Promise<EnsureOutcome> {
  const got = await apiCall(base, "GET", `/api/agents/${slug}`);
  switch (decideEnsureAgentGet(got.status)) {
    case "exists":
      break;
    case "missing": {
      const created = await apiCall(base, "POST", "/api/agents", { slug, name: slug });
      const createDecision = decideCreateAgent(created.status);
      if (createDecision === "auth") return { ok: false, auth: true };
      if (createDecision === "fail") {
        throw new Error(`POST /api/agents → ${created.status}`);
      }
      break;
    }
    case "auth":
      return { ok: false, auth: true };
    case "fail":
      throw new Error(`GET /api/agents/${slug} → ${got.status}`);
  }

  const room = await ensureDevInRoom(base, slug);
  if (room.auth) return { ok: false, auth: true };

  const restarted = await apiCall(base, "POST", `/api/agents/${slug}/restart`);
  switch (decideRestartAgent(restarted.status)) {
    case "ok":
      return { ok: true, status: statusFromBody(restarted.body) };
    case "auth":
      return { ok: false, auth: true };
    case "fail":
      throw new Error(`POST /api/agents/${slug}/restart → ${restarted.status}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadDevVars(join(REPO_ROOT, ".dev.vars"));
  const env = envRecord();
  const missing = missingLlm(env);
  if (missing.length > 0) {
    throw new Error(`missing ${missing.join(", ")}. Set them in .dev.vars or the environment`);
  }

  const base = `http://127.0.0.1:${args.port}`;
  const model = (env.LLM_MODEL ?? "").trim();
  const host = baseHost((env.LLM_BASE_URL ?? "").trim());
  const url = chatUrl(args.port, args.slug);

  let child: ChildProcess | null = null;
  let spawned = false;

  const initial = await fetchHealth(base);
  if (initial.kind === "busy") {
    throw new Error(`port ${args.port} is in use but /api/health is not gantree`);
  } else if (initial.kind !== "gantree") {
    child = spawnDev(args.port);
    spawned = true;
    await waitForHealthAfterSpawn(child, base, args.port);
  }

  let brain: ReturnType<typeof statusFromBody> = {};
  try {
    const outcome = await ensureAgent(base, args.slug);
    if (!outcome.ok && outcome.auth) {
      process.stderr.write(`${AUTH_HINT}\n`);
    } else if (outcome.ok) {
      brain = outcome.status;
    }
  } catch (err: unknown) {
    if (spawned && child != null) {
      child.kill("SIGTERM");
    }
    throw err;
  }

  process.stdout.write(`${formatBanner({
    slug: args.slug,
    model,
    host,
    chatUrl: url,
    state: brain.state,
    published: brain.published,
  })}\n`);

  if (!spawned) return;

  const killChild = (): void => {
    if (child != null && child.exitCode == null && child.signalCode == null) {
      child.kill("SIGTERM");
    }
  };
  process.on("SIGINT", killChild);
  process.on("SIGTERM", killChild);

  await new Promise<void>((resolveWait) => {
    if (child == null) {
      process.off("SIGINT", killChild);
      process.off("SIGTERM", killChild);
      resolveWait();
      return;
    }
    child.once("exit", (code) => {
      process.off("SIGINT", killChild);
      process.off("SIGTERM", killChild);
      if (code != null && code !== 0) process.exitCode = code;
      resolveWait();
    });
  });
}

if (invokedDirectly()) {
  main().catch((err: unknown) => {
    loadDevVars(join(REPO_ROOT, ".dev.vars"));
    process.stderr.write(`${publicError(err, collectSecrets(envRecord()))}\n`);
    process.exitCode = 1;
  });
}
