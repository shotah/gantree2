import type { Usage } from "./types";
import { asRecord, isRecord, num, parseJSON, redact, str, truncate } from "./wire";

const DEFAULT_BASE = "https://serpapi.com";

export type SerpClient = {
  apiKey: string;
  baseURL: string;
  fetch: typeof fetch;
  signal?: AbortSignal;
};

export function clientFrom(env: Readonly<Record<string, string>>, fetchFn: typeof fetch, signal?: AbortSignal): SerpClient {
  const base = env.SERPAPI_BASE_URL?.trim().replace(/\/$/, "") ?? "";
  return {
    apiKey: env.SERPAPI_API_KEY?.trim() ?? "",
    baseURL: base === "" ? DEFAULT_BASE : base,
    fetch: fetchFn,
    signal,
  };
}

export async function getJSON(client: SerpClient, path: string, params: Record<string, string> | null): Promise<unknown> {
  if (client.apiKey === "") {
    throw new Error("SERPAPI_API_KEY is required");
  }
  const query = new URLSearchParams();
  if (params !== null) {
    for (const [key, value] of Object.entries(params)) {
      query.set(key, value);
    }
  }
  query.set("api_key", client.apiKey);
  const endpointPath = path.startsWith("/") ? path : `/${path}`;
  const endpoint = `${client.baseURL}${endpointPath}?${query.toString()}`;
  let response: Response;
  try {
    response = await client.fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "flights-search-mcp/1.0",
      },
      signal: client.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? redact(err.message, client.apiKey) : "serpapi request failed";
    if (err instanceof Error) {
      err.message = message;
    }
    throw new Error(message, { cause: err });
  }
  const text = (await response.text()).slice(0, 8 << 20);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`serpapi HTTP ${String(response.status)}: ${truncate(text, 400)}`);
  }
  let parsed: unknown;
  try {
    parsed = parseJSON(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid json";
    throw new Error(`decode serpapi response: ${message}`, { cause: err });
  }
  if (isRecord(parsed) && typeof parsed.error === "string" && parsed.error !== "") {
    throw new Error(`serpapi: ${parsed.error}`);
  }
  return parsed;
}

export async function account(client: SerpClient): Promise<Usage> {
  const raw = asRecord(await getJSON(client, "/account.json", null));
  let left = num(raw.total_searches_left);
  const planLeft = num(raw.plan_searches_left);
  if (left === 0 && planLeft > 0) {
    left = planLeft;
  }
  const usage: Usage = {
    searchesUsed: num(raw.this_month_usage),
    searchesLeft: left,
    searchesPerMonth: num(raw.searches_per_month),
  };
  const renewal = str(raw.plan_renewal_date);
  const plan = str(raw.plan_name);
  if (renewal !== "") {
    usage.planRenewalDate = renewal;
  }
  if (plan !== "") {
    usage.planName = plan;
  }
  return usage;
}

export async function usageOrNil(client: SerpClient): Promise<Usage | undefined> {
  try {
    return await account(client);
  } catch {
    return undefined;
  }
}
