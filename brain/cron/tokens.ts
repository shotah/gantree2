import { ReactPrefix, WaitToken, NoWaitToken } from "./constants";

export function stripBareToken(s: string, token: string): { text: string; found: boolean } {
  const tok = token.trim();
  if (!tok || !s) return { text: s, found: false };
  const lowerTok = tok.toLowerCase();
  let found = false;
  const keep: string[] = [];
  for (const line of s.split("\n")) {
    const t = line.trim();
    let next = line;
    if (t.toLowerCase() === lowerTok) {
      found = true;
      continue;
    }
    const n = tok.length;
    if (t.length > n && t.toLowerCase().endsWith(` ${lowerTok}`)) {
      found = true;
      next = t.slice(0, t.length - n).trim();
    }
    keep.push(next);
  }
  return { text: keep.join("\n").trim(), found };
}

/** "[react X]" exactly: prefix, non-empty body, closing bracket, nothing after. */
export function wholeReactToken(t: string): string | null {
  const lower = t.toLowerCase();
  if (!lower.startsWith(ReactPrefix) || !t.endsWith("]")) return null;
  const body = t.slice(ReactPrefix.length, -1).trim();
  if (!body || body.includes("[") || body.includes("]") || body.includes("\n")) return null;
  return body;
}

export function stripReactTokens(s: string): { text: string; emoji: string } {
  if (!s || !s.toLowerCase().includes(ReactPrefix)) return { text: s, emoji: "" };
  let emoji = "";
  const keep: string[] = [];
  for (const line of s.split("\n")) {
    const t = line.trim();
    const whole = wholeReactToken(t);
    if (whole != null) {
      if (!emoji) emoji = whole;
      continue;
    }
    const idx = t.toLowerCase().lastIndexOf(` ${ReactPrefix}`);
    let next = line;
    if (idx >= 0) {
      const emojiIn = wholeReactToken(t.slice(idx + 1));
      if (emojiIn != null) {
        if (!emoji) emoji = emojiIn;
        next = t.slice(0, idx).trim();
      }
    }
    keep.push(next);
  }
  return { text: keep.join("\n").trim(), emoji };
}

export function incompleteReactToken(t: string): boolean {
  const lower = t.toLowerCase();
  if (!lower || !lower.startsWith("[")) return false;
  if (ReactPrefix.startsWith(lower)) return true;
  return lower.startsWith(ReactPrefix) && !lower.includes("]");
}

export function incompleteWaitToken(t: string): boolean {
  const lower = t.toLowerCase();
  if (!lower || !lower.startsWith("[")) return false;
  for (const tok of [WaitToken.toLowerCase(), NoWaitToken.toLowerCase()]) {
    if (lower !== tok && tok.startsWith(lower)) return true;
  }
  return false;
}

export function trimIncompleteWaitSuffix(t: string): { text: string; ok: boolean } {
  const lower = t.toLowerCase();
  for (const tok of [WaitToken.toLowerCase(), NoWaitToken.toLowerCase()]) {
    for (let n = 1; n < tok.length; n += 1) {
      if (lower.endsWith(` ${tok.slice(0, n)}`)) {
        return { text: t.slice(0, t.length - n).trim(), ok: true };
      }
    }
  }
  return { text: t, ok: false };
}

export function stripIncompleteWaitLine(s: string): string {
  if (!s) return s;
  const lines = s.split("\n");
  const i = lines.length - 1;
  const last = lines[i] ?? "";
  const t = last.trim();
  if (incompleteWaitToken(t) || incompleteReactToken(t)) {
    return lines.slice(0, i).join("\n").trim();
  }
  const trimmed = trimIncompleteWaitSuffix(t);
  if (trimmed.ok) {
    lines[i] = trimmed.text;
    return lines.join("\n").trim();
  }
  const j = t.lastIndexOf(" [");
  if (j >= 0 && incompleteReactToken(t.slice(j + 1))) {
    lines[i] = t.slice(0, j).trim();
    return lines.join("\n").trim();
  }
  return s;
}
