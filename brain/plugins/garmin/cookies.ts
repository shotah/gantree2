export type StoredCookie = {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
};

export function parseSetCookie(header: string): StoredCookie | null {
  const parts = header.split(";").map((part) => part.trim()).filter((part) => part !== "");
  const nv = parts[0];
  if (!nv) return null;
  const eq = nv.indexOf("=");
  if (eq <= 0) return null;
  const cookie: StoredCookie = { name: nv.slice(0, eq), value: nv.slice(eq + 1) };
  for (const attr of parts.slice(1)) {
    const eqAt = attr.indexOf("=");
    const rawKey = (eqAt === -1 ? attr : attr.slice(0, eqAt)).trim().toLowerCase();
    const rawVal = eqAt === -1 ? "" : attr.slice(eqAt + 1).trim();
    if (rawKey === "path" && rawVal) cookie.path = rawVal;
    else if (rawKey === "domain" && rawVal) cookie.domain = rawVal;
    else if (rawKey === "secure") cookie.secure = true;
    else if (rawKey === "httponly") cookie.httpOnly = true;
  }
  return cookie;
}

export function readSetCookies(res: Response): StoredCookie[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const lines = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") ?? ""] : []);
  const seen = new Set<string>();
  const out: StoredCookie[] = [];
  for (const line of lines) {
    const cookie = parseSetCookie(line);
    if (!cookie) continue;
    const key = `${cookie.name}|${cookie.value}|${cookie.path ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cookie);
  }
  return out;
}

export function cookieHeader(cookies: StoredCookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}
