import type { Clock } from "@/brain/core/clock";
import type { Logger } from "@/brain/core/log";
import type { Sql } from "@/brain/core/sql";
import type { OAuthToken, TokenStore } from "@/brain/core/tools";
import { GarminError } from "./json";

export const NATIVE_API_UA = "GCM-Android-5.23";
export const NATIVE_X_GARMIN_UA = "com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0";

const SKEW_MS = 5 * 60_000;
const MAX_RETRIES = 2;

export type GarminRuntime = {
  fetch: typeof fetch;
  clock: Clock;
  tokens: TokenStore;
  sql: Sql;
  log: Logger;
};

export type Session = {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
  diClientId: string;
  domain: string;
  extra: Record<string, string>;
};

export function nativeHeaderRecord(): Record<string, string> {
  return {
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": NATIVE_API_UA,
    "X-App-Ver": "10861",
    "X-Garmin-Client-Platform": "Android",
    "X-Garmin-Paired-App-Version": "10861",
    "X-Garmin-User-Agent": NATIVE_X_GARMIN_UA,
    "X-GCExperience": "GC5",
    "X-Lang": "en",
  };
}

export function sessionFromToken(token: OAuthToken | null): Session | null {
  if (!token?.accessToken) return null;
  return {
    accessToken: token.accessToken,
    diClientId: token.extra?.diClientId ?? "",
    domain: token.extra?.domain || "garmin.com",
    expiresAt: token.expiresAt,
    extra: { ...(token.extra ?? {}) },
    refreshToken: token.refreshToken ?? "",
    scope: token.scope,
    tokenType: token.tokenType,
  };
}

export function isExpired(session: Session, now: number): boolean {
  return now + SKEW_MS > (session.expiresAt ?? 0);
}

export async function putSession(tokens: TokenStore, session: Session): Promise<void> {
  const extra: Record<string, string> = { ...session.extra, diClientId: session.diClientId, domain: session.domain };
  const token: OAuthToken = {
    accessToken: session.accessToken,
    extra,
    refreshToken: session.refreshToken || undefined,
  };
  if (session.expiresAt != null) token.expiresAt = session.expiresAt;
  if (session.scope) token.scope = session.scope;
  if (session.tokenType) token.tokenType = session.tokenType;
  await tokens.put("garmin", token);
}

/** Courtesy throttle (~30/min, burst 8). Wall clock, so a frozen test clock cannot stall it. */
let bucket = 8;
let bucketAt = 0;

export function resetRateLimiter(): void {
  bucket = 8;
  bucketAt = 0;
}

async function takeToken(signal?: AbortSignal): Promise<void> {
  const now = Date.now();
  if (bucketAt === 0) bucketAt = now;
  const elapsed = now - bucketAt;
  if (elapsed > 0) {
    bucket = Math.min(8, bucket + elapsed / (60_000 / 30));
    bucketAt = now;
  }
  if (bucket >= 1) {
    bucket -= 1;
    return;
  }
  const wait = Math.ceil((1 - bucket) * (60_000 / 30));
  await sleep(wait, signal);
  bucket = 0;
  bucketAt = Date.now();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GarminError("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new GarminError("aborted"));
    }, { once: true });
  });
}

function backoffMs(attempt: number): number {
  const initial = 200;
  const cap = 2_000;
  let backoff = initial * (2 ** attempt);
  if (backoff > cap) backoff = cap;
  const jitter = Math.floor(Math.random() * (backoff / 4));
  return backoff + jitter;
}

async function connectGet(rt: GarminRuntime, url: string, accessToken: string, signal?: AbortSignal): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await takeToken(signal);
    const res = await rt.fetch(url, {
      headers: {
        ...nativeHeaderRecord(),
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      method: "GET",
      signal,
    });
    const retry = attempt < MAX_RETRIES && (res.status === 429 || res.status >= 500);
    if (!retry) return res;
    await res.text();
    last = res;
    await sleep(backoffMs(attempt), signal);
  }
  if (last) return last;
  throw new GarminError("garmin: max retries exceeded");
}

export async function apiGet(rt: GarminRuntime, path: string, signal?: AbortSignal, opts?: { notFound?: boolean }): Promise<string> {
  const notFound = opts?.notFound !== false;
  let session = await load(rt);
  if (isExpired(session, rt.clock.now())) session = await refreshSession(rt, session, signal);
  let res = await connectGet(rt, apiUrl(session.domain, path), session.accessToken, signal);
  if (res.status === 401) {
    session = await refreshSession(rt, session, signal);
    res = await connectGet(rt, apiUrl(session.domain, path), session.accessToken, signal);
  }
  if (notFound && (res.status === 204 || res.status === 404)) {
    throw new GarminError("garmin: resource not found");
  }
  return res.text();
}

function apiUrl(domain: string, path: string): string {
  return `https://connectapi.${domain}${path}`;
}

async function load(rt: GarminRuntime): Promise<Session> {
  const session = sessionFromToken(await rt.tokens.get("garmin"));
  if (!session) throw new GarminError("garmin: not authenticated");
  return session;
}

export async function refreshSession(rt: GarminRuntime, session: Session, signal?: AbortSignal): Promise<Session> {
  if (!session.refreshToken || !session.diClientId) {
    throw new GarminError("garmin: session expired, re-login required: missing DI refresh token or client id");
  }
  const { refreshDiToken } = await import("./sso");
  try {
    const next = await refreshDiToken({
      clientId: session.diClientId,
      domain: session.domain,
      fetch: rt.fetch,
      nowMs: rt.clock.now(),
      refreshToken: session.refreshToken,
      signal,
    });
    const updated: Session = {
      ...session,
      accessToken: next.accessToken,
      diClientId: next.clientId || session.diClientId,
      expiresAt: next.expiresAt,
      refreshToken: next.refreshToken || session.refreshToken,
      scope: next.scope || undefined,
      tokenType: next.tokenType || session.tokenType,
    };
    await putSession(rt.tokens, updated);
    rt.log.info("garmin token refreshed");
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("garmin: session expired")) throw err;
    throw new GarminError(`garmin: session expired, re-login required: ${message}`);
  }
}
