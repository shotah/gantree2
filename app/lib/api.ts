/** Same-origin fetch for the settings screens. A 401 sends the browser back through the door. */

export const USERS_URL = "/api/users";

export function userUrl(entry: string): string {
  return `/api/users/${encodeURIComponent(entry)}`;
}

export async function api(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (typeof init?.body === "string" && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(input, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers,
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.replace("/login");
  }
  return res;
}
