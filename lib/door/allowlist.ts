/**
 * Allowlist entry grammar. Shared by the app allowlist, every agent's chat
 * list (wire name PENDANT_ALLOWED_USERS), cab and helm.
 *
 *   118212345678901234567                   sub
 *   118212345678901234567:ada@example.com   sub with a label
 *   ada@example.com                         verified-email alias
 *
 * `sub` is the key. Email only ever matches; it never identifies.
 */
export type AllowEntry = {
  sub: string | null;
  email: string | null;
};

export type Identity = {
  sub: string;
  email: string | null;
  emailVerified: boolean;
};

const SUB_RE = /^\d{10,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isSub(value: string): boolean {
  return SUB_RE.test(value);
}

export function parseEntry(raw: string): AllowEntry | null {
  const t = raw.trim();
  if (!t) {
    return null;
  }
  const colon = t.indexOf(":");
  if (colon >= 0) {
    const sub = t.slice(0, colon).trim();
    const email = t.slice(colon + 1).trim().toLowerCase();
    if (!SUB_RE.test(sub) || !EMAIL_RE.test(email)) {
      return null;
    }
    return { sub, email };
  }
  if (t.includes("@")) {
    const email = t.toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return null;
    }
    return { sub: null, email };
  }
  if (SUB_RE.test(t)) {
    return { sub: t, email: null };
  }
  return null;
}

export function formatEntry(entry: AllowEntry): string {
  if (entry.sub && entry.email) {
    return `${entry.sub}:${entry.email}`;
  }
  if (entry.sub) {
    return entry.sub;
  }
  return entry.email ?? "";
}

/** Split, parse, drop junk, dedupe by sub then by email. */
export function parseAllowlist(raw: string | string[] | null | undefined): AllowEntry[] {
  const parts = Array.isArray(raw) ? raw : (raw ?? "").split(/[,\s]+/);
  const out: AllowEntry[] = [];
  const seenSub = new Set<string>();
  const seenEmail = new Set<string>();
  for (const p of parts) {
    const entry = parseEntry(p);
    if (!entry) {
      continue;
    }
    if (entry.sub && seenSub.has(entry.sub)) {
      continue;
    }
    if (entry.email && seenEmail.has(entry.email)) {
      continue;
    }
    if (entry.sub) {
      seenSub.add(entry.sub);
    }
    if (entry.email) {
      seenEmail.add(entry.email);
    }
    out.push(entry);
  }
  return out;
}

export function formatAllowlist(entries: AllowEntry[]): string {
  return entries.map(formatEntry).filter(Boolean).join(",");
}

/**
 * Admission. `sub` matches exactly. Email matches only when Google says it is
 * verified, exact after lowercasing. No Gmail-dot or +tag normalization.
 */
export function entryMatches(entry: AllowEntry, who: Identity): boolean {
  if (entry.sub && entry.sub === who.sub) {
    return true;
  }
  if (entry.email && who.emailVerified && who.email && entry.email === who.email.toLowerCase()) {
    return true;
  }
  return false;
}

export function onList(entries: AllowEntry[], who: Identity): boolean {
  return entries.some((e) => entryMatches(e, who));
}
