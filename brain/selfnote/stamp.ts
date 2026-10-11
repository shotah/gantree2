/**
 * SELF.md kernel header and the persona sections gantry owns. Operators do
 * not edit these; load/sync overwrites them.
 */

export const fileName = "SELF.md";

/** ~1k tokens. Grown personality must not crowd the prompt. */
export const maxChars = 4096;

export const header = [
  "# SELF.md — Who You Are Becoming",
  "",
  "> Agent-written file. Cap ~4KB; the operator may prune any line.",
  ">",
  "> **`self_note` APPENDS one new `-` line — it does NOT overwrite this file.**",
  "> Do not re-note something already listed below. Skip if the vibe or north-star is already here.",
  "> A few north-star aims (how you show up for months) belong here. Progress logs are memory, not this file.",
  "> Distill on `/new` merges. Keep exact jokes and nicknames. A vibe word",
  "> (\"dry\") is not a substitute for a quote.",
].join("\n");

export const rulesSection = [
  "## Self-notes (`self_note` → SELF.md)",
  "",
  "- **Append-only.** One short `-` line. Does **not** rewrite `SELF.md`.",
  "- Skip if the vibe or north-star is already in the `SELF.md` bullets in this prompt.",
  "- Personality / jokes / rituals / a few north-star aims only — not facts, progress logs, or tool recipes.",
  "- A north-star is one sentence that changes how you show up for months. Progress, dates, and open loops are memory_store. A one-off to-do is memory or cron.",
  "- Empty board: no north-star in SELF.md and no [aims] line in [harness] → ask ONE months-scale question and memory_store fact subject aim/bootstrap in the same batch as your other tools. Do not invent, do not memory_recall to check — [harness] already shows it: `[aims] none (asked <date>)` means you asked that day; do not ask again until tomorrow. After they answer: self_note + memory_store insight subject aim/<area>.",
  "- Prefer exact joke wording and nicknames in SELF.md. A vibe word is not a joke.",
  "- Do this **unprompted** when a vibe or north-star lands. `/new` distill merges (does not flatten jokes).",
].join("\n");

export const locationSection = [
  "## Location pins",
  "",
  "- Pendant GPS and Telegram location/venue update this chat's last known `[location]` (in-memory). A GPS-only frame with no chat text updates that cache and does not start a turn.",
  "- `[location]` is on this turn's user-line time footer (after their words; they did not type it), with when it was from. Use those `lat,lng` for maps `near` or route origin. Do not invent a city.",
  "- just now / minutes: you have a current fix. Hours old: still their last known place — say so if a live pin matters, otherwise use it. Missing: no GPS this process; ask them to send with GPS on (pendant) or a Telegram location. Do not guess.",
].join("\n");

function looksLikeSelfTitle(line: string): boolean {
  const stripped = line.trim().replace(/^#+/u, "").trim();
  return stripped.toLowerCase().includes("self.md");
}

/** SELF.md without the kernel header (title + leading blockquotes). */
export function body(raw: string): string {
  const s = raw.trim();
  if (s === "") {
    return "";
  }
  const lines = s.split("\n");
  let i = 0;
  const first = lines[0] ?? "";
  if (looksLikeSelfTitle(first)) {
    i += 1;
  }
  while (i < lines.length) {
    const t = (lines[i] ?? "").trim();
    if (t === "" || t.startsWith(">")) {
      i += 1;
      continue;
    }
    break;
  }
  return lines.slice(i).join("\n").trim();
}

/** Header plus the file body. Empty body is the header alone. */
export function stamp(raw: string): string {
  const text = body(raw);
  if (text === "") {
    return header;
  }
  return `${header}\n\n${text}`;
}

export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Byte cap, backing up so a rune is not split. Trims, matching Go's Write clip. */
export function clipUtf8(s: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(s);
  if (maxBytes < 1 || bytes.length <= maxBytes) {
    return s;
  }
  let cut = maxBytes;
  while (cut > 0) {
    const b = bytes[cut];
    if (b === undefined || (b & 0xc0) !== 0x80) {
      break;
    }
    cut -= 1;
  }
  return new TextDecoder().decode(bytes.subarray(0, cut)).trim();
}
