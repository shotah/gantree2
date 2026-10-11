import { migrate } from "@/brain/core/sql";
import type { OAuthToken, PluginContext } from "@/brain/core/tools";
import { decodeBase64UrlToString, encodeBase64UrlRaw } from "@/brain/plugins/google/codec";
import { isRecord } from "@/brain/plugins/google/args";

/**
 * Scopes the Go server requests (`auth.DefaultScopes`). One authorize URL
 * covers every Workspace service this plugin (and google-health) calls.
 */
export const GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/chat.spaces",
  "https://www.googleapis.com/auth/forms",
  "https://www.googleapis.com/auth/script.projects",
] as const;

export const CLIENT_ID_ENV = "GOOGLE_OAUTH_CLIENT_ID";
export const CLIENT_SECRET_ENV = "GOOGLE_OAUTH_CLIENT_SECRET";
export const USER_EMAIL_ENV = "USER_GOOGLE_EMAIL";
export const REDIRECT_URI_ENV = "GOOGLE_OAUTH_REDIRECT_URI";

export const AUTH_URL = "https://accounts.google.com/o/oauth2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/** Same catch page `google-mcp auth url` uses when GOOGLE_OAUTH_REDIRECT_URI is unset. */
export const DEFAULT_REDIRECT_URI = "https://github.bldhosting.com/oauth-catch/";

const PENDING_TTL_MS = 10 * 60 * 1000;
/** Refresh this long before the stored expiry so a call doesn't race the clock. */
const REFRESH_SKEW_MS = 60_000;

const MISSING_CLIENT = "OAuth client credentials not found. Please set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET environment variables";

export class EmailRequired extends Error {
  constructor() {
    super("USER_GOOGLE_EMAIL is required (or pass user_google_email)");
    this.name = "EmailRequired";
  }
}

export class AuthFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthFailed";
  }
}

export function canonicalEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function clientCreds(ctx: PluginContext): { id: string; secret: string } | undefined {
  const id = ctx.env[CLIENT_ID_ENV] ?? "";
  const secret = ctx.env[CLIENT_SECRET_ENV] ?? "";
  if (!id || !secret) {
    return undefined;
  }
  return { id, secret };
}

/** Go's url.Values.Encode / QueryEscape: sorted keys, space as `+`. */
export function formEncode(params: Record<string, string>): string {
  return Object.keys(params).sort().map((key) => `${queryEscape(key)}=${queryEscape(params[key] ?? "")}`).join("&");
}

function queryEscape(s: string): string {
  let out = "";
  const bytes = new TextEncoder().encode(s);
  for (const b of bytes) {
    if ((b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || (b >= 0x30 && b <= 0x39) || b === 0x2d || b === 0x5f || b === 0x2e) {
      out += String.fromCharCode(b);
    } else if (b === 0x20) {
      out += "+";
    } else {
      out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

function ensureSchema(ctx: PluginContext): void {
  migrate(ctx.sql, [{
    id: "plugin.google.001",
    up: [
      `CREATE TABLE IF NOT EXISTS google_oauth_pending (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state TEXT NOT NULL,
        verifier TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
    ],
  }]);
}

type PendingRow = { state: string; verifier: string; redirect_uri: string; expires_at: number };

function loadPending(ctx: PluginContext): PendingRow | undefined {
  ensureSchema(ctx);
  const row = ctx.sql.one<PendingRow>("SELECT state, verifier, redirect_uri, expires_at FROM google_oauth_pending WHERE id = 1");
  return row ?? undefined;
}

function savePending(ctx: PluginContext, row: PendingRow): void {
  ensureSchema(ctx);
  ctx.sql.exec(
    `INSERT INTO google_oauth_pending (id, state, verifier, redirect_uri, expires_at)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       state = excluded.state,
       verifier = excluded.verifier,
       redirect_uri = excluded.redirect_uri,
       expires_at = excluded.expires_at`,
    row.state,
    row.verifier,
    row.redirect_uri,
    row.expires_at,
  );
}

function deletePending(ctx: PluginContext): void {
  ensureSchema(ctx);
  ctx.sql.exec("DELETE FROM google_oauth_pending WHERE id = 1");
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return encodeBase64UrlRaw(new Uint8Array(digest));
}

function newVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return encodeBase64UrlRaw(bytes);
}

/**
 * Authorization URL: union of DefaultScopes, offline access, consent, PKCE S256.
 * The verifier is stored in `google_oauth_pending` for authFinish (the host
 * does not pass it back). `state` is the host's CSRF token.
 */
export async function buildAuthUrl(ctx: PluginContext, redirectUri: string, state: string): Promise<string> {
  const creds = clientCreds(ctx);
  if (!creds) {
    throw new AuthFailed(MISSING_CLIENT);
  }
  const verifier = newVerifier();
  const challenge = await codeChallenge(verifier);
  savePending(ctx, {
    state,
    verifier,
    redirect_uri: redirectUri,
    expires_at: ctx.clock.now() + PENDING_TTL_MS,
  });
  const q = formEncode({
    access_type: "offline",
    client_id: creds.id,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "consent",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    state,
  });
  return `${AUTH_URL}?${q}`;
}

export async function authStart(ctx: PluginContext, redirectUri: string, state: string): Promise<{ url: string }> {
  const url = await buildAuthUrl(ctx, redirectUri, state);
  return { url };
}

export async function authFinish(ctx: PluginContext, redirectUri: string, code: string): Promise<void> {
  const creds = clientCreds(ctx);
  if (!creds) {
    throw new AuthFailed(MISSING_CLIENT);
  }
  if (!code.trim()) {
    throw new AuthFailed("OAuth token exchange: missing code");
  }
  const pending = loadPending(ctx);
  let verifier = "";
  if (pending) {
    if (ctx.clock.now() > pending.expires_at) {
      deletePending(ctx);
      throw new AuthFailed("pending auth session expired; run 'google-mcp auth url' again");
    }
    if (pending.redirect_uri !== redirectUri) {
      throw new AuthFailed("redirect_uri does not match the pending auth session");
    }
    verifier = pending.verifier;
  }
  const params: Record<string, string> = {
    client_id: creds.id,
    client_secret: creds.secret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  };
  if (verifier) {
    params.code_verifier = verifier;
  }
  const tok = await postToken(ctx, params, undefined);
  const email = await resolveAccountEmail(ctx, tok);
  if (email) {
    tok.extra = { ...tok.extra, email };
  }
  await ctx.tokens.put("google", tok);
  deletePending(ctx);
  ctx.log.info("google oauth stored", { email: email || undefined });
}

async function resolveAccountEmail(ctx: PluginContext, tok: OAuthToken): Promise<string> {
  const fromId = emailFromIdToken(tok.extra?.id_token);
  if (fromId) {
    return canonicalEmail(fromId);
  }
  try {
    const info = await ctx.fetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${tok.accessToken}` },
    });
    const text = await info.text();
    if (!info.ok) {
      throw new AuthFailed(`userinfo returned ${info.status}: ${text}`);
    }
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed) && typeof parsed.email === "string" && parsed.email.trim()) {
      return canonicalEmail(parsed.email);
    }
    throw new AuthFailed("no email in userinfo response");
  } catch (e) {
    const fallback = canonicalEmail(ctx.env[USER_EMAIL_ENV] ?? "");
    if (fallback) {
      return fallback;
    }
    const msg = e instanceof Error ? e.message : "userinfo failed";
    throw new AuthFailed(`fetch user email: ${msg}`);
  }
}

export function emailFromIdToken(idToken: string | undefined): string {
  if (!idToken) {
    return "";
  }
  const payload = idToken.split(".")[1];
  if (!payload) {
    return "";
  }
  try {
    const parsed: unknown = JSON.parse(decodeBase64UrlToString(payload));
    if (isRecord(parsed) && typeof parsed.email === "string") {
      return parsed.email.trim();
    }
  } catch {
    return "";
  }
  return "";
}

export function needsRefresh(tok: OAuthToken, now: number): boolean {
  if (tok.expiresAt == null) {
    return false;
  }
  return now >= tok.expiresAt - REFRESH_SKEW_MS;
}

export async function freshToken(ctx: PluginContext, signal?: AbortSignal): Promise<OAuthToken> {
  const tok = await ctx.tokens.get("google");
  if (!tok?.accessToken) {
    throw new AuthFailed("no credentials found; run: google-mcp auth");
  }
  if (!needsRefresh(tok, ctx.clock.now())) {
    return tok;
  }
  if (!tok.refreshToken) {
    return tok;
  }
  return refreshToken(ctx, tok, signal);
}

export async function refreshToken(ctx: PluginContext, tok: OAuthToken, signal?: AbortSignal): Promise<OAuthToken> {
  const creds = clientCreds(ctx);
  if (!creds) {
    throw new AuthFailed(MISSING_CLIENT);
  }
  if (!tok.refreshToken) {
    throw new AuthFailed("token expired and no refresh token");
  }
  const next = await postToken(ctx, {
    client_id: creds.id,
    client_secret: creds.secret,
    grant_type: "refresh_token",
    refresh_token: tok.refreshToken,
  }, tok, signal);
  await ctx.tokens.put("google", next);
  ctx.log.info("google oauth refreshed");
  return next;
}

async function postToken(ctx: PluginContext, params: Record<string, string>, previous: OAuthToken | undefined, signal?: AbortSignal): Promise<OAuthToken> {
  const res = await ctx.fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formEncode(params),
    signal,
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!res.ok || !isRecord(parsed) || typeof parsed.access_token !== "string" || !parsed.access_token) {
    const detail = tokenErrorDetail(parsed, text, res.status);
    const prefix = params.grant_type === "refresh_token" ? "token refresh failed" : "OAuth token exchange";
    throw new AuthFailed(`${prefix}: ${detail}`);
  }
  const expiresIn = typeof parsed.expires_in === "number" ? parsed.expires_in : undefined;
  const extra: Record<string, string> = { ...previous?.extra };
  if (typeof parsed.id_token === "string" && parsed.id_token) {
    extra.id_token = parsed.id_token;
  }
  const email = emailFromIdToken(extra.id_token);
  if (email) {
    extra.email = canonicalEmail(email);
  }
  const refresh = typeof parsed.refresh_token === "string" && parsed.refresh_token
    ? parsed.refresh_token
    : previous?.refreshToken;
  const scope = typeof parsed.scope === "string" && parsed.scope ? parsed.scope : previous?.scope;
  const tokenType = typeof parsed.token_type === "string" && parsed.token_type
    ? parsed.token_type
    : (previous?.tokenType ?? "Bearer");
  const next: OAuthToken = {
    accessToken: parsed.access_token,
    tokenType,
    extra: Object.keys(extra).length ? extra : undefined,
  };
  if (refresh) {
    next.refreshToken = refresh;
  }
  if (scope) {
    next.scope = scope;
  }
  if (expiresIn != null) {
    next.expiresAt = ctx.clock.now() + expiresIn * 1000;
  } else if (previous?.expiresAt != null && params.grant_type === "refresh_token") {
    next.expiresAt = previous.expiresAt;
  }
  return next;
}

function tokenErrorDetail(parsed: unknown, text: string, status: number): string {
  if (isRecord(parsed)) {
    const err = typeof parsed.error === "string" ? parsed.error : "";
    const desc = typeof parsed.error_description === "string" ? parsed.error_description : "";
    if (err && desc) {
      return `${err} ${desc}`;
    }
    if (err) {
      return err;
    }
  }
  return text.trim() || String(status);
}

/**
 * Email for tool text and credential matching.
 * Arg, then USER_GOOGLE_EMAIL, then the single stored account.
 */
export async function resolveEmail(ctx: PluginContext, args: Record<string, unknown>): Promise<string> {
  const fromArg = canonicalEmail(typeof args.user_google_email === "string" ? args.user_google_email : "");
  if (fromArg) {
    return fromArg;
  }
  const fromEnv = canonicalEmail(ctx.env[USER_EMAIL_ENV] ?? "");
  if (fromEnv) {
    return fromEnv;
  }
  const tok = await ctx.tokens.get("google");
  const fromTok = canonicalEmail(tok?.extra?.email ?? "");
  if (fromTok) {
    return fromTok;
  }
  throw new EmailRequired();
}
