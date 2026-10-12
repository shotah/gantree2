import type { OAuthToken, PluginContext } from "@/harness/core/tools";
import { encodeQuery } from "./encode.ts";
import { errorMessage, StravaError, toOAuthToken } from "./helpers.ts";

const apiBase = "https://www.strava.com/api/v3";
const tokenUrl = "https://www.strava.com/api/v3/oauth/token";
const skewMs = 300_000;

export type RateLimits = {
  limit15: number;
  limitDaily: number;
  usage15: number;
  usageDaily: number;
};

const clients = new WeakMap<PluginContext, StravaClient>();

export function clientFor(ctx: PluginContext): StravaClient {
  const existing = clients.get(ctx);
  if (existing) return existing;
  const client = new StravaClient(ctx);
  clients.set(ctx, client);
  return client;
}

/** Authenticated Strava API client. Refreshes on expiry and once on 401. */
export class StravaClient {
  private limits: RateLimits = { limit15: 0, limitDaily: 0, usage15: 0, usageDaily: 0 };
  private inflight: Promise<OAuthToken> | null = null;

  constructor(private readonly ctx: PluginContext) {}

  rateLimits(): RateLimits {
    return { ...this.limits };
  }

  rateLimitWarning(): string {
    if (!this.over15()) return "";
    return `Note: ${this.limits.usage15}/${this.limits.limit15} API calls used in this 15-min window.`;
  }

  async get(path: string, params?: Record<string, string>, signal?: AbortSignal): Promise<string> {
    const query = params && Object.keys(params).length > 0 ? `?${encodeQuery(params)}` : "";
    return this.doRequest("GET", `${apiBase}${path}${query}`, undefined, "", signal);
  }

  async post(path: string, body: unknown, signal?: AbortSignal): Promise<string> {
    return this.jsonRequest("POST", path, body, signal);
  }

  async put(path: string, body: unknown, signal?: AbortSignal): Promise<string> {
    return this.jsonRequest("PUT", path, body, signal);
  }

  private async jsonRequest(method: string, path: string, body: unknown, signal?: AbortSignal): Promise<string> {
    let payload: string;
    try {
      payload = JSON.stringify(body);
    } catch (err) {
      throw new Error(`marshal request body: ${errorMessage(err)}`, { cause: err });
    }
    return this.doRequest(method, `${apiBase}${path}`, payload, "application/json", signal);
  }

  private async doRequest(method: string, url: string, body: string | undefined, contentType: string, signal?: AbortSignal): Promise<string> {
    let token = await this.readToken();
    if (this.isExpired(token)) {
      try {
        token = await this.refresh(signal);
      } catch (err) {
        throw new Error(`token refresh: ${errorMessage(err)}`, { cause: err });
      }
    }
    try {
      return await this.execute(method, url, body, contentType, token.accessToken, signal);
    } catch (err) {
      if (err instanceof StravaError && err.statusCode === 401) {
        try {
          token = await this.refresh(signal);
        } catch (refreshErr) {
          throw new Error(`token refresh after 401: ${errorMessage(refreshErr)}`, { cause: refreshErr });
        }
        return this.execute(method, url, body, contentType, token.accessToken, signal);
      }
      throw err;
    }
  }

  private async readToken(): Promise<OAuthToken> {
    let token: OAuthToken | null;
    try {
      token = await this.ctx.tokens.get("strava");
    } catch (err) {
      throw new Error(`read tokens: ${errorMessage(err)}`, { cause: err });
    }
    if (!token?.accessToken) throw new Error("read tokens: no tokens");
    return token;
  }

  private isExpired(token: OAuthToken): boolean {
    const expiresAt = token.expiresAt ?? 0;
    return this.ctx.clock.now() >= expiresAt - skewMs;
  }

  private refresh(signal?: AbortSignal): Promise<OAuthToken> {
    if (this.inflight) {
      return this.inflight.then((token) => {
        this.ctx.log.debug("token refresh result shared with concurrent caller");
        return token;
      });
    }
    const job = this.doRefresh(signal).finally(() => {
      if (this.inflight === job) this.inflight = null;
    });
    this.inflight = job;
    return job;
  }

  private async doRefresh(signal?: AbortSignal): Promise<OAuthToken> {
    const current = await this.readForRefresh();
    this.ctx.log.debug("refreshing strava token");
    const form = encodeQuery({
      client_id: this.ctx.env.STRAVA_CLIENT_ID ?? "",
      client_secret: this.ctx.env.STRAVA_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: current.refreshToken ?? "",
    });
    let response: Response;
    try {
      response = await this.ctx.fetch(tokenUrl, {
        body: form,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
        signal,
      });
    } catch (err) {
      throw new Error(`refresh request: ${errorMessage(err)}`, { cause: err });
    }
    const text = await response.text();
    if (response.status !== 200) {
      throw new Error(`refresh failed (${response.status}): ${text}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(`decode refresh response: ${errorMessage(err)}`, { cause: err });
    }
    let next: OAuthToken;
    try {
      next = toOAuthToken(parsed);
    } catch (err) {
      throw new Error(`decode refresh response: ${errorMessage(err)}`, { cause: err });
    }
    try {
      await this.ctx.tokens.put("strava", next);
    } catch (err) {
      throw new Error(`persist refreshed tokens: ${errorMessage(err)}`, { cause: err });
    }
    this.ctx.log.debug("token refreshed successfully");
    return next;
  }

  private async readForRefresh(): Promise<OAuthToken> {
    try {
      const token = await this.ctx.tokens.get("strava");
      if (!token) throw new Error("no tokens");
      return token;
    } catch (err) {
      throw new Error(`read tokens for refresh: ${errorMessage(err)}`, { cause: err });
    }
  }

  private async execute(method: string, url: string, body: string | undefined, contentType: string, accessToken: string, signal?: AbortSignal): Promise<string> {
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    if (contentType !== "") headers["Content-Type"] = contentType;
    let response: Response;
    try {
      response = await this.ctx.fetch(url, { body, headers, method, signal });
    } catch (err) {
      throw new Error(`execute request: ${errorMessage(err)}`, { cause: err });
    }
    this.updateRateLimits(response.headers);
    let path = url;
    try {
      path = new URL(url).pathname;
    } catch {
      // keep the raw url out of the log only when it is not a URL
    }
    this.ctx.log.debug("strava request", { method, path, status: response.status });
    let text: string;
    try {
      text = await response.text();
    } catch (err) {
      throw new Error(`read response body: ${errorMessage(err)}`, { cause: err });
    }
    if (response.status >= 400) throw new StravaError(response.status, text);
    return text;
  }

  private over15(): boolean {
    return this.limits.usage15 > 0
      && this.limits.limit15 > 0
      && this.limits.usage15 > Math.trunc(0.8 * this.limits.limit15);
  }

  private updateRateLimits(headers: Headers): void {
    const limitStr = headers.get("x-ratelimit-limit") ?? "";
    const usageStr = headers.get("x-ratelimit-usage") ?? "";
    if (limitStr === "" && usageStr === "") return;
    if (limitStr !== "") {
      const parts = splitN(limitStr, ",", 2);
      this.limits.limit15 = atoi(parts[0] ?? "");
      if (parts.length >= 2) this.limits.limitDaily = atoi(parts[1] ?? "");
    }
    if (usageStr !== "") {
      const parts = splitN(usageStr, ",", 2);
      this.limits.usage15 = atoi(parts[0] ?? "");
      if (parts.length >= 2) this.limits.usageDaily = atoi(parts[1] ?? "");
    }
    if (this.over15()) {
      this.ctx.log.warn("approaching rate limit", { limit: this.limits.limit15, usage: this.limits.usage15 });
    }
  }
}

function splitN(value: string, sep: string, n: number): string[] {
  if (n <= 1) return [value];
  const index = value.indexOf(sep);
  if (index < 0) return [value];
  return [value.slice(0, index), ...splitN(value.slice(index + sep.length), sep, n - 1)];
}

function atoi(value: string): number {
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return 0;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}
