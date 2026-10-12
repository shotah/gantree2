import type { Role } from "./users";

/** Cookie that says "skip the console, open chat". Set from Settings or the chat drawer; `/` reads it. */
export const LANDING_COOKIE = "gantree.landing";
const LANDING_MAX_AGE = 60 * 60 * 24 * 365;

/** `chat` lands on the one-agent rule; `chat:<slug>` goes straight to that room. */
export type LandingPref = { slug: string | null } | null;

/** Read the landing cookie from a `Cookie` header or `document.cookie`. Anything but `chat` / `chat:<slug>` is off. */
export function landingPref(cookies: string | null | undefined): LandingPref {
  if (!cookies) {
    return null;
  }
  for (const part of cookies.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1 || part.slice(0, eq).trim() !== LANDING_COOKIE) {
      continue;
    }
    let value: string;
    try {
      value = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
    if (value === "chat") {
      return { slug: null };
    }
    if (value.startsWith("chat:")) {
      const slug = value.slice("chat:".length).trim();
      return slug ? { slug } : { slug: null };
    }
    return null;
  }
  return null;
}

/** The `Set-Cookie` / `document.cookie` string for a landing choice; `null` clears it. */
export function landingCookie(pref: LandingPref): string {
  if (!pref) {
    return `${LANDING_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
  const value = pref.slug ? `chat:${pref.slug}` : "chat";
  return `${LANDING_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${LANDING_MAX_AGE}; SameSite=Lax`;
}

/**
 * Where `/` sends a signed-in person.
 *
 * Admins land on `/agents` unless a landing cookie sends them to chat.
 * Operators and members use the chat list only. A landing cookie pins a
 * room when that slug is on the person's agent list.
 */
export function landing(who: { role: Role; agents: readonly string[] }, pref: LandingPref = null): string {
  if (pref?.slug) {
    const slug = pref.slug.trim();
    if (slug && who.agents.includes(slug)) {
      return `/chat/${encodeURIComponent(slug)}`;
    }
  } else if (pref && who.role === "admin") {
    if (who.agents.length === 1) {
      const slug = who.agents[0]?.trim();
      if (slug) {
        return `/chat/${encodeURIComponent(slug)}`;
      }
    }
    return "/chat";
  }
  if (!pref && who.role === "admin") {
    return "/agents";
  }
  if (who.agents.length === 1) {
    const slug = who.agents[0]?.trim();
    if (slug) {
      return `/chat/${encodeURIComponent(slug)}`;
    }
  }
  return "/chat";
}

/** Settings grants ∪ room admission. Blanks drop out; order is stable. */
export function agentUnion(grants: readonly string[], admitted: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of [...grants, ...admitted]) {
    const slug = raw.trim();
    if (slug) {
      out.add(slug);
    }
  }
  return [...out].sort();
}

export type SessionView = {
  role: Role;
  agents: string[];
  sub: string;
  email: string | null;
};

/** `GET /api/auth/me`. `agents` wins; `cranes` is only the older alias. */
export function readSession(body: unknown): SessionView | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.sub !== "string" || record.sub.length === 0) {
    return null;
  }
  const role = record.role;
  if (role !== "admin" && role !== "operator" && role !== "member") {
    return null;
  }
  const email = typeof record.email === "string" && record.email.length > 0 ? record.email : null;
  const listed = Array.isArray(record.agents) ? record.agents : Array.isArray(record.cranes) ? record.cranes : [];
  const agents = listed
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  return { role, agents, sub: record.sub, email };
}

export type ManageLink = { href: string; label: string };

/**
 * Gear-menu rows: the way back out of chat. Only admins get manage links
 * and Settings; operators and members stay in chat.
 */
export function manageRows(who: { role: Role; agents: readonly string[] } | null, slug: string | null): ManageLink[] {
  if (!who || who.role !== "admin") {
    return [];
  }
  const rows: ManageLink[] = [];
  if (slug) {
    rows.push({ href: `/agents/${encodeURIComponent(slug)}`, label: `Manage ${slug}` });
  }
  rows.push({ href: "/agents", label: "All agents" });
  rows.push({ href: "/settings", label: "Settings" });
  return rows;
}
