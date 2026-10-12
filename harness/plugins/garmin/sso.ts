import { cookieHeader, readSetCookies, type StoredCookie } from "./cookies";
import { encodeForm } from "./form";
import { errorMessage, GarminError, isRecord, parseJson } from "./json";
import { nativeHeaderRecord } from "./http";

export const IOS_SSO_CLIENT_ID = "GCM_IOS_DARK";
export const IOS_LOGIN_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
export const DI_GRANT_TYPE = "https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket";
export const DI_CLIENT_IDS = [
  "GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2",
  "GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4",
  "GARMIN_CONNECT_MOBILE_ANDROID_DI",
  "GARMIN_CONNECT_MOBILE_IOS_DI",
];
export const AUTH_GUIDE_URL = "https://github.com/shotah/gantree2/blob/main/docs/mcp.md#keys";
export const MFA_TTL_MS = 10 * 60_000;

export function serviceUrl(domain: string): string {
  if (domain === "garmin.cn") return "https://mobile.integration.garmin.cn/gcm/ios";
  return "https://mobile.integration.garmin.com/gcm/ios";
}

export function loginParams(domain: string): Record<string, string[]> {
  return {
    clientId: [IOS_SSO_CLIENT_ID],
    locale: ["en-US"],
    service: [serviceUrl(domain)],
  };
}

export function mfaInstruction(method: string): string {
  return [
    `garmin: MFA required (${method}) — check your email/app for the code`,
    "then paste the code: /auth garmin <code>",
    `guide: ${AUTH_GUIDE_URL}`,
  ].join("\n");
}

export function authorizedInstruction(): string {
  return [`garmin: authorized ✓`, `guide: ${AUTH_GUIDE_URL}`].join("\n");
}

export function hasCreds(env: Readonly<Record<string, string>>): boolean {
  return (env.GARMIN_EMAIL ?? "").trim() !== "" && (env.GARMIN_PASSWORD ?? "") !== "";
}

export function creds(env: Readonly<Record<string, string>>): { email: string; password: string } {
  const email = (env.GARMIN_EMAIL ?? "").trim();
  const password = env.GARMIN_PASSWORD ?? "";
  if (!email || password === "") {
    throw new GarminError("set GARMIN_EMAIL and GARMIN_PASSWORD in the environment (never paste them in chat)");
  }
  return { email, password };
}

type FetchFn = typeof fetch;

export type DiToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  tokenType: string;
  clientId: string;
};

export type LoginStart
  = | { mfa: false; ticket: string }
    | { mfa: true; method: string; domain: string; loginParams: Record<string, string[]>; cookies: StoredCookie[] };

function statusLine(res: Response): string {
  return res.statusText ? `${String(res.status)} ${res.statusText}` : String(res.status);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

function decodeB64Url(seg: string): string {
  const cleaned = seg.replace(/-/g, "+").replace(/_/g, "/");
  const pad = cleaned.length % 4 === 0 ? "" : "=".repeat(4 - (cleaned.length % 4));
  return atob(cleaned + pad);
}

export function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  const body = parts[1];
  if (!body) return null;
  try {
    const parsed = parseJson(decodeB64Url(body));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function jwtClientId(token: string): string {
  const payload = jwtPayload(token);
  return payload && typeof payload.client_id === "string" ? payload.client_id : "";
}

function jwtExpMs(token: string): number | null {
  const payload = jwtPayload(token);
  if (!payload || typeof payload.exp !== "number") return null;
  return payload.exp * 1000;
}

async function readBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch (err) {
    throw new GarminError(errorMessage(err));
  }
}

async function doSsoJson(fetchFn: FetchFn, method: string, url: string, payload: unknown, domain: string, cookies: StoredCookie[], signal?: AbortSignal): Promise<{ body: string; status: number }> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    Origin: `https://sso.${domain}`,
    "User-Agent": IOS_LOGIN_UA,
  };
  const cookie = cookieHeader(cookies);
  if (cookie) headers.Cookie = cookie;
  let res: Response;
  try {
    res = await fetchFn(url, { body: JSON.stringify(payload), headers, method, signal });
  } catch (err) {
    throw new GarminError(errorMessage(err));
  }
  return { body: await readBody(res), status: res.status };
}

type SsoStatus = { type: string; message: string; ticket: string; mfaMethod: string; error429: boolean };

function readSso(body: string, status: number): SsoStatus {
  let parsed: unknown;
  try {
    parsed = parseJson(body);
  } catch (err) {
    throw new GarminError(`HTTP ${String(status)}: ${errorMessage(err)}`);
  }
  if (!isRecord(parsed)) throw new GarminError(`HTTP ${String(status)}: not an object`);
  const responseStatus = isRecord(parsed.responseStatus) ? parsed.responseStatus : {};
  const info = isRecord(parsed.customerMfaInfo) ? parsed.customerMfaInfo : null;
  const error = isRecord(parsed.error) ? parsed.error : null;
  return {
    error429: error?.["status-code"] === "429",
    message: typeof responseStatus.message === "string" ? responseStatus.message : "",
    mfaMethod: info && typeof info.mfaLastMethodUsed === "string" ? info.mfaLastMethodUsed : "",
    ticket: typeof parsed.serviceTicketId === "string" ? parsed.serviceTicketId : "",
    type: typeof responseStatus.type === "string" ? responseStatus.type : "",
  };
}

function loginFailed(detail: string): GarminError {
  return new GarminError(`garmin: login failed: ${detail}`);
}

export async function loginStart(opts: {
  fetch: FetchFn;
  email: string;
  password: string;
  domain?: string;
  signal?: AbortSignal;
}): Promise<LoginStart & { responseCookies: StoredCookie[] }> {
  const domain = opts.domain || "garmin.com";
  const params = loginParams(domain);
  const url = `https://sso.${domain}/mobile/api/login?${encodeForm(firstValues(params))}`;
  let res: Response;
  try {
    res = await opts.fetch(url, {
      body: JSON.stringify({
        captchaToken: "",
        password: opts.password,
        rememberMe: true,
        username: opts.email,
      }),
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Origin: `https://sso.${domain}`,
        "User-Agent": IOS_LOGIN_UA,
      },
      method: "POST",
      signal: opts.signal,
    });
  } catch (err) {
    throw new GarminError(`failed to submit mobile login: ${errorMessage(err)}`);
  }
  const body = await readBody(res).catch((err: unknown) => {
    throw new GarminError(`failed to submit mobile login: ${errorMessage(err)}`);
  });
  if (res.status === 429) throw loginFailed("mobile login rate limited (429)");
  if (res.status === 403) throw loginFailed("mobile login blocked (403 Cloudflare)");
  let status: SsoStatus;
  try {
    status = readSso(body, res.status);
  } catch (err) {
    throw new GarminError(`failed to parse mobile login response (HTTP ${String(res.status)}): ${errorMessage(err).replace(/^HTTP \d+: /, "")}`);
  }
  if (status.error429) throw loginFailed("mobile login rate limited (429)");
  if (status.type === "SUCCESSFUL") {
    if (!status.ticket) throw loginFailed("empty service ticket");
    return { mfa: false, responseCookies: readSetCookies(res), ticket: status.ticket };
  }
  if (status.type === "MFA_REQUIRED") {
    return {
      cookies: readSetCookies(res),
      domain,
      loginParams: params,
      method: status.mfaMethod || "email",
      mfa: true,
      responseCookies: readSetCookies(res),
    };
  }
  if (status.type === "INVALID_USERNAME_PASSWORD") throw loginFailed("invalid username or password");
  if (status.type === "CAPTCHA_REQUIRED") throw loginFailed("captcha required");
  const msg = status.message ? `${status.type}: ${status.message}` : (status.type || `HTTP ${String(res.status)}`);
  throw loginFailed(msg);
}

export async function submitMfa(opts: {
  fetch: FetchFn;
  domain: string;
  loginParams: Record<string, string[]>;
  method: string;
  code: string;
  cookies: StoredCookie[];
  signal?: AbortSignal;
}): Promise<string> {
  const url = `https://sso.${opts.domain}/mobile/api/mfa/verifyCode?${encodeForm(firstValues(opts.loginParams))}`;
  let result: { body: string; status: number };
  try {
    result = await doSsoJson(opts.fetch, "POST", url, {
      mfaMethod: opts.method,
      mfaSetup: false,
      mfaVerificationCode: opts.code,
      reconsentList: [],
      rememberMyBrowser: false,
    }, opts.domain, opts.cookies, opts.signal);
  } catch (err) {
    throw new GarminError(`failed to submit MFA code: ${errorMessage(err)}`);
  }
  let status: SsoStatus;
  try {
    status = readSso(result.body, result.status);
  } catch (err) {
    throw new GarminError(`failed to parse MFA response (HTTP ${String(result.status)}): ${errorMessage(err).replace(/^HTTP \d+: /, "")}`);
  }
  if (status.type !== "SUCCESSFUL" || !status.ticket) {
    const msg = status.message ? `${status.type}: ${status.message}` : status.type;
    throw loginFailed(`MFA failed (${msg})`);
  }
  return status.ticket;
}

function firstValues(params: Record<string, string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, values] of Object.entries(params)) out[key] = values[0] ?? "";
  return out;
}

export async function exchangeServiceTicket(opts: {
  fetch: FetchFn;
  domain: string;
  ticket: string;
  nowMs: number;
  signal?: AbortSignal;
}): Promise<DiToken> {
  let last: unknown;
  for (const clientId of DI_CLIENT_IDS) {
    try {
      return await postDiToken({
        clientId,
        domain: opts.domain,
        fetch: opts.fetch,
        fields: {
          client_id: clientId,
          grant_type: DI_GRANT_TYPE,
          service_ticket: opts.ticket,
          service_url: serviceUrl(opts.domain),
        },
        nowMs: opts.nowMs,
        signal: opts.signal,
      });
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new GarminError("no DI client IDs configured");
}

export async function refreshDiToken(opts: {
  fetch: FetchFn;
  domain: string;
  refreshToken: string;
  clientId: string;
  nowMs: number;
  signal?: AbortSignal;
}): Promise<DiToken> {
  return postDiToken({
    clientId: opts.clientId,
    domain: opts.domain,
    fetch: opts.fetch,
    fields: {
      client_id: opts.clientId,
      grant_type: "refresh_token",
      refresh_token: opts.refreshToken,
    },
    nowMs: opts.nowMs,
    signal: opts.signal,
  });
}

async function postDiToken(opts: {
  fetch: FetchFn;
  domain: string;
  clientId: string;
  fields: Record<string, string>;
  nowMs: number;
  signal?: AbortSignal;
}): Promise<DiToken> {
  const clientId = opts.fields.client_id || opts.clientId;
  const headers: Record<string, string> = {
    ...nativeHeaderRecord(),
    Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
    Authorization: `Basic ${btoa(`${clientId}:`)}`,
    "Cache-Control": "no-cache",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  let res: Response;
  try {
    res = await opts.fetch(`https://diauth.${opts.domain}/di-oauth2-service/oauth/token`, {
      body: encodeForm(opts.fields),
      headers,
      method: "POST",
      signal: opts.signal,
    });
  } catch (err) {
    throw new GarminError(errorMessage(err));
  }
  const body = await readBody(res);
  if (res.status === 429) throw new GarminError("DI token exchange rate limited (429)");
  if (res.status !== 200) {
    throw new GarminError(`DI token exchange failed for ${clientId}: ${statusLine(res)} - ${truncate(body, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = parseJson(body);
  } catch (err) {
    throw new GarminError(`failed to parse DI token response: ${errorMessage(err)}`);
  }
  if (!isRecord(parsed) || typeof parsed.access_token !== "string" || parsed.access_token === "") {
    throw new GarminError("DI token response missing access_token");
  }
  const expiresIn = typeof parsed.expires_in === "number" ? parsed.expires_in : 0;
  const resolved = jwtClientId(parsed.access_token) || clientId;
  return {
    accessToken: parsed.access_token,
    clientId: resolved,
    expiresAt: expiresIn > 0 ? opts.nowMs + expiresIn * 1000 : (jwtExpMs(parsed.access_token) ?? opts.nowMs + 3_600_000),
    refreshToken: typeof parsed.refresh_token === "string" ? parsed.refresh_token : "",
    scope: typeof parsed.scope === "string" ? parsed.scope : "",
    tokenType: typeof parsed.token_type === "string" ? parsed.token_type : "",
  };
}
