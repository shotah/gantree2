#!/usr/bin/env node
/**
 * Photographable household, through the HTTP API (not the database).
 *
 *   npm run dev:shot                # the dev server on .dev.vars.shot
 *   npm run seed
 *   npm run seed -- --vars          # write .dev.vars.shot, then stop
 *   npm run seed -- --base=http://127.0.0.1:3000
 *
 * Needs `npm run dev:shot` on loopback. That server reads `.dev.vars.shot`,
 * which seed derives from `.dev.vars`: same secrets, but the dev user and
 * the only admin are the placeholder `dev@example.com`, so no real account
 * is ever in a picture. The dev user is signed in on 127.0.0.1 with no
 * Google round-trip. Status, perf, and
 * log land on the agent socket (`/ws/<slug>?role=agent`) after the config
 * frame; chat lines use the phone socket. Re-running is safe: create
 * treats 409 as already there, room lists are replaced, log lines are
 * sent once, chat frames reuse stable ids.
 *
 * The allowlist grammar is a 10–32 digit sub, so the local dev identity
 * is `100000000000000000001:dev@example.com`, not a word like `dev-sub`.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONA_TEMPLATE } from "../app/components/agents/personaTemplate.ts";
import { tomlFromGrants } from "../lib/agents/mcpToml.ts";
import type { Grant } from "../lib/agents/types.ts";
import { parseAllowlist, parseEntry } from "../lib/door/allowlist.ts";
import { sealSession, SESSION_COOKIE, sessionKey } from "../lib/door/session.ts";

export const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Local-only identity. Digits, because that is the allowlist sub grammar. */
export const DEV_SUB = "100000000000000000001";
export const DEV_EMAIL = "dev@example.com";
export const DEV_USER = `${DEV_SUB}:${DEV_EMAIL}`;

/** `CLOUDFLARE_ENV` for the photographable server; it reads `.dev.vars.shot`. */
export const SHOT_ENV = "shot";
export const SHOT_VARS_FILE = `.dev.vars.${SHOT_ENV}`;

/**
 * `.dev.vars.shot` from `.dev.vars`: every key carried, the identity keys
 * forced to the placeholder so a real sub or email never reaches a shot.
 * Bearers already minted into the previous shot file win over `.dev.vars`,
 * so a re-run does not rotate them under a running server.
 */
export function shotVars(real: string, previousShot = ""): string {
  let next = real.length === 0 || real.endsWith("\n") ? real : `${real}\n`;
  next = upsertAssignment(next, "GANTREE_DEV_USER", DEV_USER);
  next = upsertAssignment(next, "GANTREE_ADMINS", DEV_USER);
  next = upsertAssignment(next, "GANTREE_ALLOW", "");
  if (parseDevVars(next).has("VAPID_SUBJECT")) {
    next = upsertAssignment(next, "VAPID_SUBJECT", `mailto:${DEV_EMAIL}`);
  }
  const kept = parseDevVars(previousShot).get("AGENT_BEARERS")?.trim() ?? "";
  if (kept) {
    next = upsertAssignment(next, "AGENT_BEARERS", kept);
  }
  return next;
}

/** Second principal: a member on both rooms, so /chat can show the picker. */
export const MEMBER_SUB = "100000000000000000002";
export const MEMBER_EMAIL = "sam@example.com";
export const MEMBER_ENTRY = `${MEMBER_SUB}:${MEMBER_EMAIL}`;

export const MEMBER_COOKIE_NAME = "gantree2-member-cookie";
export const LOG_MARKER = "published maps";

export const SEED_AGENTS = [
  { slug: "kit", name: "Kit", tags: ["walks"] },
  { slug: "ada", name: "Ada", tags: ["mail"] },
] as const;

export const SEED_GRANTS: readonly Grant[] = [
  { name: "maps", command: "google-maps-mcp", env: ["GOOGLE_MAPS_API_KEY"] },
  { name: "google", command: "google-mcp", env: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"] },
];

export type SeedCall = {
  method: "GET" | "POST" | "PATCH" | "PUT";
  path: string;
  body?: unknown;
};

export type WireObject = Record<string, unknown>;

export type ChatSend = {
  role: "phone" | "agent";
  body: WireObject;
};

export type DevIdentity = { sub: string; email: string };

export function parseSeedArgs(argv: readonly string[]): { help: boolean; varsOnly: boolean; base: string } {
  let base = "http://127.0.0.1:3000";
  let help = false;
  let varsOnly = false;
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--vars") {
      varsOnly = true;
    } else if (arg.startsWith("--base=")) {
      const value = arg.slice("--base=".length);
      if (!value) {
        throw new Error("usage: seed.ts [--vars] [--base=url]");
      }
      base = value;
    } else {
      throw new Error(`unknown arg ${arg}`);
    }
  }
  return { help, varsOnly, base };
}

export function parseDevVars(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    out.set(key, trimmed.slice(eq + 1));
  }
  return out;
}

export function upsertAssignment(text: string, key: string, value: string): string {
  const lines = text.split("\n");
  let found = false;
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      return line;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 1) {
      return line;
    }
    if (trimmed.slice(0, eq).trim() !== key) {
      return line;
    }
    found = true;
    return `${key}=${value}`;
  });
  if (!found) {
    if (next.length > 0 && next[next.length - 1] === "") {
      next.splice(next.length - 1, 0, `${key}=${value}`);
    } else {
      next.push(`${key}=${value}`);
    }
  }
  const joined = next.join("\n");
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}

/** Append `email` unless an entry already names that email or that sub. */
export function mergeAdminValue(current: string, email: string, sub?: string): string {
  const entries = parseAllowlist(current);
  if (entries.some((entry) => entry.email === email || (sub !== undefined && entry.sub === sub))) {
    return current;
  }
  const trimmed = current.trim();
  return trimmed ? `${trimmed},${email}` : email;
}

export function parseBearerMap(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of raw.split(",")) {
    const bit = part.trim();
    const colon = bit.indexOf(":");
    if (colon < 1) {
      continue;
    }
    const slug = bit.slice(0, colon).trim();
    const token = bit.slice(colon + 1).trim();
    if (slug && token) {
      out.set(slug, token);
    }
  }
  return out;
}

/** Keep existing slug tokens. Fill only slugs that are missing. */
export function fillBearers(current: string, fresh: string, slugs: readonly string[]): string {
  const have = parseBearerMap(current);
  const add = parseBearerMap(fresh);
  let changed = false;
  for (const slug of slugs) {
    const token = add.get(slug);
    if (!have.get(slug) && token) {
      have.set(slug, token);
      changed = true;
    }
  }
  if (!changed) {
    return current;
  }
  const parts: string[] = [];
  for (const [slug, token] of have) {
    parts.push(`${slug}:${token}`);
  }
  return parts.join(",");
}

export function bearerFor(raw: string | undefined, slug: string): string | null {
  if (!raw) {
    return null;
  }
  return parseBearerMap(raw).get(slug) ?? null;
}

/**
 * Local-only keys the screenshots need. Does not rewrite a dev user or a
 * bearer that is already set. `added` is key names, never values.
 */
export function ensureShotVars(text: string, freshBearers: string): { text: string; added: string[] } {
  const added: string[] = [];
  let next = text.length === 0 || text.endsWith("\n") ? text : `${text}\n`;
  const dev = parseDevVars(next).get("GANTREE_DEV_USER")?.trim() ?? "";
  if (!dev) {
    next = upsertAssignment(next, "GANTREE_DEV_USER", DEV_USER);
    added.push("GANTREE_DEV_USER");
  }
  // Admin whoever the dev user actually is — a real person's entry stays theirs.
  const who = parseEntry(dev || DEV_USER);
  const admins = parseDevVars(next).get("GANTREE_ADMINS") ?? "";
  const merged = who?.email ? mergeAdminValue(admins, who.email, who.sub ?? undefined) : admins;
  if (merged !== admins) {
    next = upsertAssignment(next, "GANTREE_ADMINS", merged);
    added.push("GANTREE_ADMINS");
  }
  const bearers = parseDevVars(next).get("AGENT_BEARERS") ?? "";
  const filled = fillBearers(bearers, freshBearers, ["kit", "ada"]);
  if (filled !== bearers) {
    next = upsertAssignment(next, "AGENT_BEARERS", filled);
    added.push("AGENT_BEARERS");
  }
  return { text: next, added };
}

export function devIdentityFrom(raw: string | undefined): DevIdentity | null {
  if (!raw?.trim()) {
    return null;
  }
  const entry = parseEntry(raw);
  if (!entry?.sub || !entry.email) {
    return null;
  }
  return { sub: entry.sub, email: entry.email };
}

export function personaFor(agentName: string, humanName: string, email: string): string {
  return PERSONA_TEMPLATE
    .replace("- **Name:** (pick one)", `- **Name:** ${agentName}`)
    .replace("- **Name:** Your Name", `- **Name:** ${humanName}`)
    .replace("you@example.com", email)
    .replace("City, Region", "San Francisco, CA");
}

export function createAgentCall(agent: { slug: string; name: string; tags: readonly string[] }): SeedCall {
  return {
    method: "POST",
    path: "/api/agents",
    body: { slug: agent.slug, name: agent.name, tags: [...agent.tags] },
  };
}

export function classifyCreate(status: number): "created" | "present" | "failed" {
  if (status === 201) {
    return "created";
  }
  if (status === 409) {
    return "present";
  }
  return "failed";
}

export function configCall(slug: string, agentName: string, email: string): SeedCall {
  return {
    method: "PATCH",
    path: `/api/agents/${slug}/config`,
    body: { persona: personaFor(agentName, "Sam", email), mcp: tomlFromGrants(SEED_GRANTS) },
  };
}

export function roomUsersFor(dev: DevIdentity): { sub: string; email: string }[] {
  const rows = [
    { sub: dev.sub, email: dev.email },
    { sub: MEMBER_SUB, email: MEMBER_EMAIL },
  ];
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.sub)) {
      return false;
    }
    seen.add(row.sub);
    return true;
  });
}

export function usersCall(slug: string, dev: DevIdentity): SeedCall {
  return {
    method: "PUT",
    path: `/api/agents/${slug}/users`,
    body: { users: roomUsersFor(dev) },
  };
}

export function memberCall(): SeedCall {
  return {
    method: "POST",
    path: "/api/users",
    body: { entry: MEMBER_ENTRY, role: "member", agents: [] },
  };
}

export function harnessFrames(): WireObject[] {
  return [
    {
      kind: "status",
      published: ["maps"],
      skipped: [{ name: "google", reason: "no_oauth" }],
    },
    { kind: "perf", turn: "seed-1", source: "chat", outcome: "ok", tokens: { prompt: 840, completion: 160 } },
    { kind: "perf", turn: "seed-2", source: "chat", outcome: "ok", tokens: { prompt: 420, completion: 90 } },
    { kind: "log", level: "info", message: LOG_MARKER },
    { kind: "log", level: "info", message: "google skipped: no_oauth" },
    { kind: "log", level: "info", message: "turn ok" },
    { kind: "snapshot", stamp: "20261010T180000Z", bytes: 48211 },
  ];
}

export function logMessagesFrom(body: unknown): string[] {
  if (!body || typeof body !== "object") {
    return [];
  }
  const record = body as { lines?: unknown };
  if (!Array.isArray(record.lines)) {
    return [];
  }
  const out: string[] = [];
  for (const line of record.lines) {
    const row = line as { message?: unknown };
    if (typeof row.message === "string") {
      out.push(row.message);
    }
  }
  return out;
}

export function shouldSendLogs(messages: readonly string[]): boolean {
  return !messages.includes(LOG_MARKER);
}

export function framesToSend(messages: readonly string[]): WireObject[] {
  const frames = harnessFrames();
  if (shouldSendLogs(messages)) {
    return frames;
  }
  return frames.filter((frame) => frame.kind !== "log");
}

export function chatScript(userId: string): ChatSend[] {
  return [
    {
      role: "phone",
      body: { kind: "inbound", id: "seed-kit-in-1", text: "What's a dry walk from the ferry building?" },
    },
    {
      role: "agent",
      body: {
        kind: "reply",
        id: "seed-kit-re-1",
        user_id: userId,
        text: "Embarcadero to Pier 39 is about twenty-five minutes, and the afternoon stays clear.",
      },
    },
    {
      role: "phone",
      body: { kind: "inbound", id: "seed-kit-in-2", text: "Put that on today." },
    },
  ];
}

export function agentSocketUrl(base: string, slug: string): string {
  const url = new URL(`/ws/${slug}`, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("role", "agent");
  return url.toString();
}

export function phoneSocketUrl(base: string, slug: string): string {
  const url = new URL(`/ws/${slug}`, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("role", "phone");
  return url.toString();
}

export function memberCookiePath(): string {
  return join(tmpdir(), MEMBER_COOKIE_NAME);
}

export function freshBearerLine(): string {
  return `kit:${randomBytes(24).toString("hex")},ada:${randomBytes(24).toString("hex")}`;
}

type HttpResult = { status: number; body: unknown };

function errorCode(body: unknown): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return "request_failed";
}

async function call(base: string, req: SeedCall): Promise<HttpResult> {
  const headers = new Headers();
  if (req.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(new URL(req.path, base), {
    method: req.method,
    headers,
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
  }
  return { status: res.status, body };
}

async function must(base: string, req: SeedCall, ok: number[]): Promise<HttpResult> {
  const result = await call(base, req);
  if (!ok.includes(result.status)) {
    throw new Error(`${req.method} ${req.path} → ${result.status} ${errorCode(result.body)}`);
  }
  return result;
}

type SocketCtor = new (url: string, options?: { headers?: Record<string, string> }) => WebSocket;

function openSocket(url: string, headers: Record<string, string>): WebSocket {
  const Ctor = WebSocket as unknown as SocketCtor;
  return new Ctor(url, { headers });
}

function eventData(ev: Event): unknown {
  const record = ev as unknown as { data?: unknown };
  return record.data;
}

function socketText(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  return "";
}

function isConfig(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    return Boolean(parsed && typeof parsed === "object" && "kind" in parsed && parsed.kind === "config");
  } catch {
    return false;
  }
}

function waitOpen(ws: WebSocket, ms: number): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket did not open")), ms);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("socket failed"));
    }, { once: true });
  });
}

function waitConfig(ws: WebSocket, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for config")), ms);
    const onMessage = (ev: Event): void => {
      if (!isConfig(socketText(eventData(ev)))) {
        return;
      }
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      resolve();
    };
    ws.addEventListener("message", onMessage);
  });
}

function waitClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.addEventListener("close", () => resolve(), { once: true });
    ws.close();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function openedAndConfigured(ws: WebSocket): Promise<void> {
  const opened = waitOpen(ws, 8000);
  const configured = waitConfig(ws, 8000);
  try {
    await opened;
    await configured;
  } catch (err) {
    await configured.catch(() => undefined);
    throw err;
  }
}

async function pushHarness(base: string, slug: string, token: string, dev: DevIdentity, chat: boolean): Promise<void> {
  const agent = openSocket(agentSocketUrl(base, slug), { authorization: `Bearer ${token}` });
  await openedAndConfigured(agent);
  const listed = await must(base, { method: "GET", path: `/api/agents/${slug}/log` }, [200]);
  const frames = framesToSend(logMessagesFrom(listed.body));
  for (const frame of frames) {
    agent.send(JSON.stringify(frame));
  }
  await must(base, usersCall(slug, dev), [200]);
  if (chat) {
    const phone = openSocket(phoneSocketUrl(base, slug), {});
    await waitOpen(phone, 8000);
    for (const line of chatScript(dev.sub)) {
      const sock = line.role === "phone" ? phone : agent;
      sock.send(JSON.stringify(line.body));
      await sleep(40);
    }
    await waitClose(phone);
  }
  await sleep(300);
  await waitClose(agent);
}

function agentSlugs(body: unknown): string[] {
  if (!body || typeof body !== "object" || !("agents" in body) || !Array.isArray(body.agents)) {
    return [];
  }
  const out: string[] = [];
  for (const item of body.agents) {
    if (typeof item === "string" && item) {
      out.push(item);
    }
  }
  return out;
}

function identityFromMe(body: unknown): DevIdentity | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const sub = "sub" in body && typeof body.sub === "string" ? body.sub : "";
  const email = "email" in body && typeof body.email === "string" ? body.email : "";
  if (!sub || !email) {
    return null;
  }
  return { sub, email };
}

export async function seedRunning(base: string, vars: Map<string, string>): Promise<void> {
  const ping = await call(base, { method: "GET", path: "/api/auth/me" });
  if (ping.status !== 200) {
    throw new Error(`GET /api/auth/me → ${ping.status} ${errorCode(ping.body)} (is npm run dev up on loopback?)`);
  }
  const dev = identityFromMe(ping.body) ?? devIdentityFrom(vars.get("GANTREE_DEV_USER"));
  if (!dev) {
    throw new Error("signed-in user has no sub and email");
  }
  if (dev.sub !== DEV_SUB) {
    throw new Error(`signed in as ${dev.email}, not ${DEV_EMAIL}: start the server with npm run dev:shot`);
  }
  const member = await call(base, memberCall());
  if (member.status !== 200) {
    throw new Error(`POST /api/users → ${member.status} ${errorCode(member.body)}`);
  }
  process.stdout.write(`member ${MEMBER_EMAIL}\n`);
  for (const agent of SEED_AGENTS) {
    const created = await call(base, createAgentCall(agent));
    const outcome = classifyCreate(created.status);
    if (outcome === "failed") {
      throw new Error(`POST /api/agents → ${created.status} ${errorCode(created.body)}`);
    }
    process.stdout.write(`${agent.slug} ${outcome}\n`);
    await must(base, configCall(agent.slug, agent.name, dev.email), [200]);
    const token = bearerFor(vars.get("AGENT_BEARERS"), agent.slug);
    if (!token) {
      throw new Error(`AGENT_BEARERS has no token for ${agent.slug}`);
    }
    await pushHarness(base, agent.slug, token, dev, agent.slug === "kit");
    process.stdout.write(`${agent.slug} harness\n`);
  }
  const me = await must(base, { method: "GET", path: "/api/auth/me" }, [200]);
  const slugs = agentSlugs(me.body);
  process.stdout.write(`me agents: ${slugs.length ? slugs.join(", ") : "none"}\n`);
  const secret = vars.get("SESSION_SECRET")?.trim() ?? "";
  if (secret.length >= 32) {
    const key = await sessionKey(secret);
    const cookie = await sealSession(key, { sub: MEMBER_SUB, email: MEMBER_EMAIL });
    writeFileSync(memberCookiePath(), cookie, { mode: 0o600 });
    process.stdout.write(`member cookie ${MEMBER_COOKIE_NAME} (cookie name ${SESSION_COOKIE})\n`);
  } else {
    process.stdout.write("member cookie skipped: SESSION_SECRET missing\n");
  }
}

function readIf(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export async function main(argv: readonly string[]): Promise<void> {
  const args = parseSeedArgs(argv);
  if (args.help) {
    process.stdout.write("npm run seed [-- --vars] [-- --base=http://127.0.0.1:3000]\n");
    return;
  }
  const shotPath = join(REPO_ROOT, SHOT_VARS_FILE);
  const before = readIf(shotPath);
  const derived = shotVars(readIf(join(REPO_ROOT, ".dev.vars")), before);
  const ensured = ensureShotVars(derived, freshBearerLine());
  if (ensured.text !== before) {
    writeFileSync(shotPath, ensured.text, { mode: 0o600 });
    process.stdout.write(`wrote ${SHOT_VARS_FILE}${ensured.added.length > 0 ? ` (new keys: ${ensured.added.join(", ")})` : ""}\n`);
  }
  if (args.varsOnly) {
    return;
  }
  if (before.length === 0 || ensured.added.includes("AGENT_BEARERS")) {
    throw new Error(`restart the dev server with npm run dev:shot so it reads ${SHOT_VARS_FILE}, then run seed again`);
  }
  await seedRunning(args.base, parseDevVars(ensured.text));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : "seed failed";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
