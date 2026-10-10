import type { Role } from "./users";

/**
 * Where `/` sends a signed-in person.
 *
 * Admin and operator run agents, so they land on `/agents`. A member with
 * one agent goes straight into that chat. Several agents, or none, get the
 * picker at `/chat`.
 */
export function landing(who: { role: Role; agents: readonly string[] }): string {
  if (who.role === "admin" || who.role === "operator") {
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
 * Gear-menu rows. Admin gets Manage `<slug>` and All agents. An operator
 * gets Manage only when this slug is on their row. Members get neither.
 */
export function manageRows(who: { role: Role; agents: readonly string[] } | null, slug: string | null): ManageLink[] {
  if (!who) {
    return [];
  }
  const rows: ManageLink[] = [];
  if (slug && (who.role === "admin" || (who.role === "operator" && who.agents.includes(slug)))) {
    rows.push({ href: `/agents/${encodeURIComponent(slug)}`, label: `Manage ${slug}` });
  }
  if (who.role === "admin") {
    rows.push({ href: "/agents", label: "All agents" });
  }
  return rows;
}
