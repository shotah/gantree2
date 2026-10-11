import type { OAuthToken, PluginContext } from "@/brain/core/tools";
import { migrate, type Migration, type Sql } from "@/brain/core/sql";
import { encodeQuery } from "./encode.ts";
import { errorMessage, toOAuthToken } from "./helpers.ts";

const authorizeUrl = "https://www.strava.com/oauth/authorize";
const tokenUrl = "https://www.strava.com/api/v3/oauth/token";
export const stravaScopes = "read,read_all,profile:read_all,profile:write,activity:read_all,activity:write";
const pendingTtlMs = 10 * 60 * 1000;

const noPending = "no pending authorization (run `strava-mcp auth url` first)";
const pendingExpired = "pending authorization expired (run `strava-mcp auth url` again)";

export const stravaMigrations: Migration[] = [
  {
    id: "plugin.strava.001",
    up: [
      `CREATE TABLE IF NOT EXISTS strava_oauth_pending (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        verifier TEXT NOT NULL,
        state TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        expires INTEGER NOT NULL
      )`,
    ],
  },
];

export function ensureSchema(sql: Sql): void {
  migrate(sql, stravaMigrations);
}

export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = base64Url(bytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { challenge: base64Url(new Uint8Array(digest)), verifier };
}

export async function authStart(ctx: PluginContext, redirectUri: string, state: string): Promise<{ url: string }> {
  ensureSchema(ctx.sql);
  const clientId = ctx.env.STRAVA_CLIENT_ID ?? "";
  const clientSecret = ctx.env.STRAVA_CLIENT_SECRET ?? "";
  if (clientId === "" || clientSecret === "") {
    throw new Error("STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET are required");
  }
  const { challenge, verifier } = await generatePkce();
  const expires = ctx.clock.now() + pendingTtlMs;
  ctx.sql.exec(
    `INSERT INTO strava_oauth_pending (id, verifier, state, redirect_uri, expires) VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET verifier = excluded.verifier, state = excluded.state, redirect_uri = excluded.redirect_uri, expires = excluded.expires`,
    verifier,
    state,
    redirectUri,
    expires,
  );
  const url = `${authorizeUrl}?${encodeQuery({
    approval_prompt: "force",
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: stravaScopes,
    state,
  })}`;
  return { url };
}

export async function authFinish(ctx: PluginContext, _redirectUri: string, code: string): Promise<void> {
  ensureSchema(ctx.sql);
  const pending = loadPending(ctx);
  const token = await exchangeCode(ctx, code, pending.verifier);
  try {
    await ctx.tokens.put("strava", token);
  } catch (err) {
    throw new Error(`persist tokens: ${errorMessage(err)}`, { cause: err });
  }
  ctx.sql.exec("DELETE FROM strava_oauth_pending WHERE id = 1");
}

export async function exchangeCode(ctx: PluginContext, code: string, codeVerifier: string): Promise<OAuthToken> {
  const params: Record<string, string> = {
    client_id: ctx.env.STRAVA_CLIENT_ID ?? "",
    client_secret: ctx.env.STRAVA_CLIENT_SECRET ?? "",
    code,
    grant_type: "authorization_code",
  };
  if (codeVerifier !== "") params.code_verifier = codeVerifier;
  let response: Response;
  try {
    response = await ctx.fetch(tokenUrl, {
      body: encodeQuery(params),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
  } catch (err) {
    throw new Error(`token exchange request: ${errorMessage(err)}`, { cause: err });
  }
  const text = await response.text();
  if (response.status !== 200) {
    throw new Error(`token exchange failed (${response.status}): ${text}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`decode token response: ${errorMessage(err)}`, { cause: err });
  }
  try {
    return toOAuthToken(parsed);
  } catch (err) {
    throw new Error(`decode token response: ${errorMessage(err)}`, { cause: err });
  }
}

type PendingRow = { verifier: string; expires: number };

function loadPending(ctx: PluginContext): PendingRow {
  const row = ctx.sql.one<PendingRow>("SELECT verifier, expires FROM strava_oauth_pending WHERE id = 1");
  if (!row) throw new Error(noPending);
  if (ctx.clock.now() > row.expires) {
    ctx.sql.exec("DELETE FROM strava_oauth_pending WHERE id = 1");
    throw new Error(pendingExpired);
  }
  return row;
}

function base64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
