import type { Clock } from "@/harness/core/clock";
import type { OAuthToken, TokenStore } from "@/harness/core/tools";
import {
  filterDailyWindow,
  filterSessionRange,
  filterSleepWindow,
  filterWeightPeriod,
} from "@/harness/plugins/google-health/civil";
import {
  mapExercise,
  mapHRVList,
  mapRestingHRList,
  mapSleepSessions,
  mapWeightEntries,
  sleepAPINote,
  type ActivitiesList,
  type Activity,
  type HeartRateList,
  type HrvList,
  type Profile,
  type SleepList,
} from "@/harness/plugins/google-health/parse";
import { asRecord, isRecord, parseJSON, redact, sortedRecord, str, truncate } from "@/harness/plugins/google-health/wire";

export const defaultBaseURL = "https://health.googleapis.com";
export const googleTokenURL = "https://oauth2.googleapis.com/token";
export const wearablesFamily = "users/me/dataSourceFamilies/google-wearables";
const expiryDeltaMs = 10_000;
const provider = "google-health";

export const coreScopes = [
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.profile.readonly",
];

const authRequired = "google health auth required — type /auth google-health in chat";

export type HealthClient = {
  clientId: string;
  clientSecret: string;
  baseURL: string;
  preferWearables: boolean;
  fetch: typeof fetch;
  signal?: AbortSignal;
  clock: Clock;
  tokens: TokenStore;
};

export function healthClient(opts: {
  clientId?: string;
  clientSecret?: string;
  baseURL?: string;
  preferWearables?: boolean;
  fetch: typeof fetch;
  signal?: AbortSignal;
  clock: Clock;
  tokens: TokenStore;
}): HealthClient {
  const base = (opts.baseURL ?? "").trim().replace(/\/+$/, "");
  return {
    clientId: (opts.clientId ?? "").trim(),
    clientSecret: (opts.clientSecret ?? "").trim(),
    baseURL: base === "" ? defaultBaseURL : base,
    preferWearables: opts.preferWearables ?? true,
    fetch: opts.fetch,
    signal: opts.signal,
    clock: opts.clock,
    tokens: opts.tokens,
  };
}

export function dataPointsURL(baseURL: string, dataType: string, suffix: string): string {
  let url = `${baseURL}/v4/users/me/dataTypes/${dataType}/dataPoints`;
  if (suffix !== "") {
    url += `:${suffix}`;
  }
  return url;
}

function tokenExpired(token: OAuthToken, now: number): boolean {
  if (token.expiresAt === undefined || token.expiresAt === 0) {
    return false;
  }
  return token.expiresAt - expiryDeltaMs < now;
}

async function ensureAccessToken(client: HealthClient): Promise<string> {
  const token = await client.tokens.get(provider);
  const access = token?.accessToken.trim() ?? "";
  if (token === null || access === "") {
    throw new Error(authRequired);
  }
  if (!tokenExpired(token, client.clock.now())) {
    return access;
  }
  const refresh = token.refreshToken?.trim() ?? "";
  if (refresh === "") {
    throw new Error("google health access token expired and no refresh_token — type /auth google-health in chat");
  }
  if (client.clientId === "" || client.clientSecret === "") {
    throw new Error("GOOGLE_HEALTH_CLIENT_ID/SECRET required to refresh tokens");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
  let response: Response;
  try {
    response = await client.fetch(googleTokenURL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
      signal: client.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? redact(redact(err.message, client.clientSecret), refresh) : "token request failed";
    if (err instanceof Error) {
      err.message = message;
    }
    throw new Error(`refresh Google Health token: ${message}`, { cause: err });
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = parseJSON(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid json";
    throw new Error(`refresh Google Health token: oauth2: cannot fetch token: ${message}`, { cause: err });
  }
  const record = asRecord(parsed);
  if (!response.ok) {
    const code = str(record?.error);
    const description = str(record?.error_description);
    if (code !== "") {
      const detail = description === "" ? `oauth2: ${JSON.stringify(code)}` : `oauth2: ${JSON.stringify(code)} ${JSON.stringify(description)}`;
      throw new Error(`refresh Google Health token: ${detail}`);
    }
    throw new Error(`refresh Google Health token: oauth2: cannot fetch token: ${String(response.status)} ${response.statusText}\nResponse: ${truncate(text.trim(), 400)}`);
  }
  const nextAccess = str(record?.access_token);
  if (nextAccess === "") {
    throw new Error("refresh Google Health token: oauth2: server response missing access_token");
  }
  const expiresIn = typeof record?.expires_in === "number" ? record.expires_in : Number(record?.expires_in ?? 0);
  const next: OAuthToken = {
    accessToken: nextAccess,
    refreshToken: str(record?.refresh_token) === "" ? refresh : str(record?.refresh_token),
    tokenType: str(record?.token_type) === "" ? (token.tokenType ?? "Bearer") : str(record?.token_type),
    scope: str(record?.scope) === "" ? token.scope : str(record?.scope),
    extra: token.extra,
  };
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    next.expiresAt = client.clock.now() + expiresIn * 1000;
  }
  await client.tokens.put(provider, next);
  return nextAccess;
}

async function doGET(client: HealthClient, rawURL: string, query: Record<string, string> | null): Promise<unknown> {
  const access = await ensureAccessToken(client);
  const url = new URL(rawURL);
  if (query !== null) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  let response: Response;
  try {
    response = await client.fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${access}`, Accept: "application/json" },
      signal: client.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? redact(err.message, access) : "request failed";
    if (err instanceof Error) {
      err.message = message;
    }
    throw new Error(`google health GET: ${message}`, { cause: err });
  }
  const text = await response.text();
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`google health API ${String(response.status)} ${response.statusText}: ${truncate(text.trim(), 400)}`);
  }
  try {
    return parseJSON(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid json";
    throw new Error(`decode reconcile response: ${message}`, { cause: err });
  }
}

type ReconcileOpts = {
  dataType: string;
  filter: string;
  pageSize: number;
  pageToken?: string;
  wearablesOnly: boolean;
};

type ReconcilePage = { points: Record<string, unknown>[]; nextPageToken: string };

async function reconcileDataPoints(client: HealthClient, opts: ReconcileOpts): Promise<ReconcilePage> {
  const query: Record<string, string> = {};
  if (opts.filter !== "") {
    query.filter = opts.filter;
  }
  if (opts.wearablesOnly) {
    query.dataSourceFamily = wearablesFamily;
  }
  if (opts.pageSize > 0) {
    query.pageSize = String(opts.pageSize);
  }
  if ((opts.pageToken ?? "") !== "") {
    query.pageToken = opts.pageToken ?? "";
  }
  const body = await doGET(client, dataPointsURL(client.baseURL, opts.dataType, "reconcile"), query);
  const record = asRecord(body);
  if (record === null && !Array.isArray(body)) {
    throw new Error("decode reconcile response: expected object");
  }
  const rawPoints = Array.isArray(record?.dataPoints) ? record.dataPoints : [];
  const points: Record<string, unknown>[] = [];
  for (const item of rawPoints) {
    if (isRecord(item)) {
      points.push(item);
    }
  }
  return { points, nextPageToken: str(record?.nextPageToken) };
}

async function reconcilePages(client: HealthClient, opts: ReconcileOpts, maxPages: number): Promise<ReconcilePage> {
  const limit = maxPages < 1 ? 1 : maxPages;
  const combined: Record<string, unknown>[] = [];
  let next = "";
  const pageOpts = { ...opts };
  for (let i = 0; i < limit; i += 1) {
    const page = await reconcileDataPoints(client, pageOpts);
    combined.push(...page.points);
    if (page.points.length === 0 || page.nextPageToken === "") {
      return { points: combined, nextPageToken: "" };
    }
    pageOpts.pageToken = page.nextPageToken;
    next = page.nextPageToken;
  }
  return { points: combined, nextPageToken: next };
}

export async function sleepGet(client: HealthClient, date: string, after: string, before: string): Promise<SleepList> {
  const filter = filterSleepWindow(date, after, before, client.clock.now(), client.clock.zone);
  const page = await reconcilePages(client, {
    dataType: "sleep",
    filter,
    pageSize: 25,
    wearablesOnly: client.preferWearables,
  }, 8);
  const sessions = mapSleepSessions(page.points, client.clock.zone);
  let note = sleepAPINote;
  if (page.nextPageToken !== "") {
    note = `truncated; narrow after_date/before_date. ${note}`;
  }
  if (sessions.length === 0) {
    return { sessions: [], count: 0, note: `no sleep sessions in range. ${note}` };
  }
  return { sessions, count: sessions.length, note };
}

export async function activitiesList(
  client: HealthClient,
  after: string,
  before: string,
  limit: number,
  pageToken: string,
): Promise<ActivitiesList> {
  const filter = filterSessionRange("exercise", after, before, client.clock.now(), client.clock.zone);
  let pageSize = limit;
  if (pageSize <= 0) {
    pageSize = 20;
  }
  if (pageSize > 25) {
    pageSize = 25;
  }
  const page = await reconcileDataPoints(client, {
    dataType: "exercise",
    filter,
    pageSize,
    pageToken,
    wearablesOnly: client.preferWearables,
  });
  return {
    activities: page.points.map(mapExercise),
    count: page.points.length,
    nextPageToken: page.nextPageToken,
    note: "exercise via dataPoints:reconcile",
  };
}

export async function activitiesGet(client: HealthClient, id: string): Promise<Activity> {
  const trimmed = id.trim();
  if (trimmed === "") {
    throw new Error("data point name is required");
  }
  const name = trimmed.includes("/") ? trimmed.replace(/^\//, "") : `users/me/dataTypes/exercise/dataPoints/${trimmed}`;
  let body: unknown;
  try {
    body = await doGET(client, `${client.baseURL}/v4/${name}`, null);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("decode reconcile response:")) {
      throw new Error(err.message.replace("decode reconcile response:", "decode data point:"), { cause: err });
    }
    throw err;
  }
  const record = asRecord(body);
  if (record === null) {
    throw new Error("decode data point: expected object");
  }
  return mapExercise(record);
}

export async function heartRateGet(client: HealthClient, date: string, after: string, before: string): Promise<HeartRateList> {
  const filter = filterDailyWindow("daily_resting_heart_rate", date, after, before, client.clock.now(), client.clock.zone);
  const page = await reconcilePages(client, {
    dataType: "daily-resting-heart-rate",
    filter,
    pageSize: 500,
    wearablesOnly: client.preferWearables,
  }, 3);
  return mapRestingHRList(page.points, page.nextPageToken !== "");
}

export async function hrvGet(client: HealthClient, date: string, after: string, before: string): Promise<HrvList> {
  const filter = filterDailyWindow("daily_heart_rate_variability", date, after, before, client.clock.now(), client.clock.zone);
  const page = await reconcilePages(client, {
    dataType: "daily-heart-rate-variability",
    filter,
    pageSize: 500,
    wearablesOnly: client.preferWearables,
  }, 3);
  return mapHRVList(page.points, page.nextPageToken !== "");
}

export async function weightGet(client: HealthClient, baseDate: string, period: string): Promise<{ entries: Record<string, unknown>[]; note: string }> {
  const filter = filterWeightPeriod(baseDate, period, client.clock.now(), client.clock.zone);
  const page = await reconcilePages(client, {
    dataType: "weight",
    filter,
    pageSize: 100,
    wearablesOnly: false,
  }, 10);
  let note = "weight via dataPoints:reconcile";
  if (page.nextPageToken !== "") {
    note = `truncated; use a shorter period. ${note}`;
  }
  return { entries: mapWeightEntries(page.points), note };
}

export async function profileGet(client: HealthClient): Promise<Profile> {
  let body: unknown;
  try {
    body = await doGET(client, `${client.baseURL}/v4/users/me/identity`, null);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("decode reconcile response:")) {
      throw new Error(err.message.replace("decode reconcile response:", "decode identity:"), { cause: err });
    }
    throw err;
  }
  const record = asRecord(body);
  if (record === null) {
    throw new Error("decode identity: expected object");
  }
  return {
    fitbitUser: str(record.legacyUserId),
    googleUser: str(record.healthUserId),
    note: "from users/me/identity (Google Health profile has no display name)",
  };
}

export async function accountStatus(client: HealthClient): Promise<Record<string, unknown>> {
  const token = await client.tokens.get(provider);
  const access = token?.accessToken.trim() ?? "";
  return sortedRecord({
    provider: "Google Health API",
    base_url: client.baseURL === "" ? defaultBaseURL : client.baseURL,
    authenticated: access !== "",
    client_id_set: client.clientId !== "",
    token_path: "",
    has_refresh_token: (token?.refreshToken ?? "").trim() !== "",
    prefer_wearables: client.preferWearables,
    scopes: [...coreScopes],
    docs_url: "https://developers.google.com/health/about",
    implementation: "live health.googleapis.com/v4 reconcile",
    boot_note: "Missing tokens do not prevent MCP initialize; data tools error until auth.",
    host_id: "ghealth",
  });
}
