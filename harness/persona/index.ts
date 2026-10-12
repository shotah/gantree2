/**
 * Persona text for the prompt. Durable rows live in `PersonaStore`.
 * `importLegacy` copies the old config string (`config.persona`) into
 * PERSONA.md once. SELF.md comes from the self-note store. This module
 * stamps the kernel sections and joins them in harness order: PERSONA.md,
 * then SELF.md. Other names are ignored.
 */
import { fileName as fileSelf, locationSection, rulesSection, stamp } from "@/harness/selfnote/stamp";

export const filePersona = "PERSONA.md";
export { fileSelf };
export { MAX_CHARS, PersonaStore, personaMigrations } from "./store";
export type { PersonaFile } from "./store";

/** Concat order. Missing parts are skipped. */
export const preferredOrder = [filePersona, fileSelf] as const;

/** Pre-collapse split. Folded into PERSONA.md when that part is absent. */
export const legacyFiles = ["SOUL.md", "RULES.md", "USER.md", "TOOLS.md"] as const;

export type PersonaPart = { name: string; text: string };

const reactionPalette = ["👍", "👎", "❤️", "🔥", "🤣", "😢", "🤔", "🙏", "👀", "🎉", "💯", "👏"];

export const reactSection = [
  "## Reactions (`[react 👍]`)",
  "",
  "- **Not a tool.** When the honest reply is an acknowledgment — noted, thanks back, nice, will do — put `[react <emoji>]` on its own line and nothing else. They see the emoji on their message, never the token. Palette: "
  + reactionPalette.join(" ")
  + " — it can say no, cry, or shrug too.",
  "- React and write only when there is something to add: `[react 👍]` plus the one line that matters (a wake you set, the next question).",
  "- Not on `[input] spoken` turns — nothing to see in a car. Never instead of a tool call or an answer.",
  "- `[reaction] 👍 on: …` as *their* turn is them reacting to you. On a question you asked, 👍 / ❤️ is yes and 👎 is no — act on it, do not ask again. A 👎 elsewhere: fix or offer to, one line. Otherwise `[silent]`.",
].join("\n");

export const waitSection = [
  "## Follow-up (`[wait]`)",
  "",
  "- **Not a tool.** If you asked a question they should answer, put `[wait]` on its own line (stripped before they see it). Two follow-up pokes if they ghost, then stop.",
  "- `[nowait]` on its own line drops the wait. `[conversation] waiting_for_reply=true` → do not ask a new different question.",
  "- Jokes, statements, and done-for-now replies: no `[wait]`. “Anything else I can do or add for you?” is optional, only when nothing is left to do and you have no question of your own, and it takes no `[wait]`.",
].join("\n");

function indexHeading(raw: string, heading: string): number {
  if (raw.startsWith(heading)) {
    return 0;
  }
  const i = raw.indexOf(`\n${heading}`);
  if (i < 0) {
    return -1;
  }
  return i + 1;
}

function nextHeading(raw: string): number {
  const i = raw.indexOf("\n## ");
  if (i >= 0) {
    return i + 1;
  }
  return -1;
}

function sectionSpan(raw: string, heading: string): { start: number; end: number } | null {
  const start = indexHeading(raw, heading);
  if (start < 0) {
    return null;
  }
  const rest = raw.slice(start + heading.length);
  const rel = nextHeading(rest);
  if (rel >= 0) {
    return { start, end: start + heading.length + rel };
  }
  return { start, end: raw.length };
}

function upsertSection(raw: string, heading: string, block: string): string {
  if (raw === "") {
    return block;
  }
  const span = sectionSpan(raw, heading);
  if (span) {
    return `${raw.slice(0, span.start)}${block}\n\n${raw.slice(span.end)}`.trim();
  }
  const mem = "## Memory hygiene";
  const at = raw.indexOf(mem);
  if (at >= 0) {
    return `${raw.slice(0, at)}${block}\n\n${raw.slice(at)}`.trim();
  }
  return `${raw}\n\n${block}`.trim();
}

/** Kernel sections: Self-notes, Location pins, Follow-up, Reactions. */
export function stampPersona(raw: string): string {
  let text = raw.trim();
  text = upsertSection(text, "## Self-notes", rulesSection);
  text = upsertSection(text, "## Location pins", locationSection);
  text = upsertSection(text, "## Follow-up", waitSection);
  text = upsertSection(text, "## Reactions", reactSection);
  return text.trim();
}

/**
 * PERSONA then SELF, each stamped. `selfNote`, when passed, is the SELF.md
 * text (including empty, which skips it). When omitted, a `SELF.md` part is used.
 * Any other part name is ignored — legacy files are not loaded here.
 */
export function assemblePersona(parts: readonly PersonaPart[], selfNote?: string): string {
  const byName = new Map<string, string>();
  for (const part of parts) {
    byName.set(part.name, part.text);
  }
  const chunks: string[] = [];
  const persona = (byName.get(filePersona) ?? "").trim();
  if (persona !== "") {
    const stamped = stampPersona(persona);
    if (stamped !== "") {
      chunks.push(stamped);
    }
  }
  const selfRaw = selfNote === undefined ? (byName.get(fileSelf) ?? "") : selfNote;
  const self = selfRaw.trim();
  if (self !== "") {
    const stamped = stamp(self);
    if (stamped !== "") {
      chunks.push(stamped);
    }
  }
  return chunks.join("\n\n");
}

/**
 * Pure form of harness `SyncKernel`. When PERSONA.md is absent, legacy
 * SOUL/RULES/USER/TOOLS are joined into it (then dropped). An existing
 * PERSONA.md is kept and stamped; legacy names are still removed.
 */
export function syncKernel(parts: readonly PersonaPart[]): { parts: PersonaPart[]; removed: string[] } {
  const byName = new Map<string, string>();
  for (const part of parts) {
    byName.set(part.name, part.text);
  }
  const removed = legacyFiles.filter((name) => byName.has(name));
  let persona: string | undefined;
  if (byName.has(filePersona)) {
    persona = byName.get(filePersona) ?? "";
  } else {
    const chunks: string[] = [];
    for (const name of legacyFiles) {
      const text = (byName.get(name) ?? "").trim();
      if (text !== "") {
        chunks.push(text);
      }
    }
    if (chunks.length > 0) {
      persona = chunks.join("\n\n");
    }
  }
  const out: PersonaPart[] = [];
  if (persona !== undefined) {
    out.push({ name: filePersona, text: stampPersona(persona) });
  }
  const skip = new Set<string>([filePersona, ...legacyFiles]);
  for (const part of parts) {
    if (skip.has(part.name)) {
      continue;
    }
    skip.add(part.name);
    out.push(part);
  }
  return { parts: out, removed: [...removed] };
}

const tzField = /timezone\*{0,3}\s*:[*\s]*([A-Za-z0-9_+/-]+)/i;

function ianaOk(name: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** IANA zone from a PERSONA.md-style Timezone field. Empty if missing or unloadable. */
export function timezoneOf(text: string): string {
  const m = tzField.exec(text);
  const name = (m?.[1] ?? "").trim();
  if (name === "" || !ianaOk(name)) {
    return "";
  }
  return name;
}

export type TimezoneResolution = { name: string; source: string };

/** Persona Timezone wins over `fallback` (CRON_TZ). Empty fallback is America/Los_Angeles. */
export function resolveTimezone(personaText: string, fallback: string): TimezoneResolution {
  const fromPersona = timezoneOf(personaText);
  if (fromPersona !== "") {
    return { name: fromPersona, source: filePersona };
  }
  let fb = fallback.trim();
  if (fb === "") {
    fb = "America/Los_Angeles";
  }
  if (ianaOk(fb)) {
    return { name: fb, source: "CRON_TZ" };
  }
  if (ianaOk("America/Los_Angeles")) {
    return { name: "America/Los_Angeles", source: "America/Los_Angeles" };
  }
  return { name: "UTC", source: "UTC" };
}
