import { errorMessage, GarminError, isRecord, parseJson } from "./json";

const CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json";

export type OAuthConsumer = { key: string; secret: string };

let cachedConsumer: OAuthConsumer | null = null;

export function clearOAuthConsumerCache(): void {
  cachedConsumer = null;
}

/** GET the public Connect OAuth1 consumer. Cached for the isolate. Login uses DI, not this. */
export async function fetchOAuthConsumer(fetchFn: typeof fetch): Promise<OAuthConsumer> {
  if (cachedConsumer) return cachedConsumer;
  let resp: Response;
  try {
    resp = await fetchFn(CONSUMER_URL);
  } catch (err) {
    throw new GarminError(errorMessage(err));
  }
  const parsed = parseJson(await resp.text());
  if (!isRecord(parsed)) throw new GarminError("oauth consumer: invalid json");
  const key = typeof parsed.consumer_key === "string" ? parsed.consumer_key : "";
  const secret = typeof parsed.consumer_secret === "string" ? parsed.consumer_secret : "";
  cachedConsumer = { key, secret };
  return cachedConsumer;
}

function isUnreserved(c: number): boolean {
  return (c >= 0x41 && c <= 0x5A)
    || (c >= 0x61 && c <= 0x7A)
    || (c >= 0x30 && c <= 0x39)
    || c === 0x2D || c === 0x2E || c === 0x5F || c === 0x7E;
}

/** OAuth 1.0 RFC 3986 percent-encoding (uppercase hex). */
export function percentEncode(s: string): string {
  let out = "";
  for (const c of new TextEncoder().encode(s)) {
    if (isUnreserved(c)) out += String.fromCharCode(c);
    else out += `%${c.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

export function encodeParams(params: Record<string, string[]>): string {
  const pairs: string[] = [];
  for (const key of Object.keys(params).sort()) {
    const values = [...(params[key] ?? [])].sort();
    for (const value of values) {
      pairs.push(`${percentEncode(key)}=${percentEncode(value)}`);
    }
  }
  return pairs.join("&");
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function generateSignature(
  method: string,
  rawUrl: string,
  params: Record<string, string[]>,
  consumerSecret: string,
  tokenSecret: string,
): Promise<string> {
  const url = new URL(rawUrl);
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
  const paramString = encodeParams(params);
  const baseString = `${percentEncode(method)}&${percentEncode(baseUrl)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(baseString));
  return bytesToBase64(new Uint8Array(mac));
}

export function buildAuthHeader(params: Record<string, string>): string {
  const parts = Object.keys(params)
    .sort()
    .map((key) => `${key}="${percentEncode(params[key] ?? "")}"`);
  return `OAuth ${parts.join(", ")}`;
}

export function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signOAuth1(opts: {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  bodyParams?: Record<string, string[]>;
  nowMs: number;
  nonce?: string;
}): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: opts.consumerKey,
    oauth_nonce: opts.nonce ?? randomNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(opts.nowMs / 1000)),
    oauth_version: "1.0",
  };
  if (opts.token) oauth.oauth_token = opts.token;

  const all: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(oauth)) all[key] = [value];
  const url = new URL(opts.url);
  for (const [key, value] of url.searchParams) {
    all[key] = [...(all[key] ?? []), value];
  }
  for (const [key, values] of Object.entries(opts.bodyParams ?? {})) {
    all[key] = [...(all[key] ?? []), ...values];
  }
  oauth.oauth_signature = await generateSignature(
    opts.method,
    opts.url,
    all,
    opts.consumerSecret,
    opts.tokenSecret ?? "",
  );
  return buildAuthHeader(oauth);
}
