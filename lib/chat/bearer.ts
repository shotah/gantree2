import { secretEqual } from "./secret";

/** Durable Object row. The harness dials with `Authorization: Bearer`. */
export const BEARER_STORE_KEY = "bearer";

/** `kit:token,ada:token2` — one bearer per agent slug. */
export function parseBearers(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw?.trim()) {
    return map;
  }
  for (const part of raw.split(",")) {
    const bit = part.trim();
    const colon = bit.indexOf(":");
    if (colon < 1) {
      continue;
    }
    const slug = bit.slice(0, colon).trim().toLowerCase();
    const token = bit.slice(colon + 1);
    if (slug && token) {
      map.set(slug, token);
    }
  }
  return map;
}

export function bearerForSlug(map: Map<string, string>, slug: string, presented: string): boolean {
  const want = map.get(slug);
  if (!want || !presented) {
    return false;
  }
  return secretEqual(want, presented);
}

export function bearerMatches(want: string | null | undefined, presented: string): boolean {
  if (!want || !presented) {
    return false;
  }
  return secretEqual(want, presented);
}

/** Internal DO read. A miss or a bad body is "no row", not an error the client sees. */
export async function fetchRoomBearer(
  stub: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> },
): Promise<string | null> {
  try {
    const res = await stub.fetch(new Request("https://agent/bearer", {
      method: "GET",
      headers: { "X-Chat-Op": "bearer" },
    }));
    if (!res.ok) {
      return null;
    }
    const json: unknown = await res.json();
    if (!json || typeof json !== "object") {
      return null;
    }
    const bearer = (json as { bearer?: unknown }).bearer;
    return typeof bearer === "string" && bearer ? bearer : null;
  } catch {
    return null;
  }
}
