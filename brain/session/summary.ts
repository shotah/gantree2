/**
 * Rolling Facts:/Voice: summary. The model folds trimmed turns; Voice quotes
 * are copied forward when a small model drops them.
 */
import type { ChatProvider } from "@/brain/core/provider";
import type { Message } from "./types";

export const summarizeSystem = `You maintain a rolling conversation summary for a personal agent.
Merge the dropped turns into the prior summary. Reply with ONLY this shape
(no markdown fences, no preamble):

Facts: <one tight paragraph>
Voice: <8–12 short lines>

Facts: durable facts, preferences, open tasks, and names. Drop other chitchat
that is not a nickname, game, or running joke — those belong on Voice.
North-star aims (how you show up for months) belong in SELF.md (self_note), not Facts.
Progress, dates, and open loops belong in Facts / memory — not SELF.md.
Use absolute dates (2006-01-02) for anything time-bound — never yesterday, tomorrow,
this morning, or a weekday alone (those go stale when the week rolls).

Voice: today's register, nicknames in play, the current game, and running jokes.
Quote a joke's exact wording — a paraphrased joke is a dead joke. Keep up to 8
short verbatim quotes (each under ~100 characters).
Copy the prior Voice block forward UNCHANGED unless a new joke, nickname, or
game appeared in the dropped turns. When something new lands, add or replace
one line and keep the exact wording. Do not paraphrase existing quotes.
If the prior summary has no Voice: line, start one from the dropped turns
(or leave Voice empty if nothing tonal happened).`;

const maxFoldMsgChars = 1200;
const maxFoldTotalChars = 12_000;
const maxSummaryChars = 4000;

const factsLabel = "Facts:";
const voiceLabel = "Voice:";

function clipText(s: string, limit: number): string {
  if (limit < 1 || s.length <= limit) {
    return s;
  }
  if (limit > 1) {
    return `${s.slice(0, limit - 1)}…`;
  }
  return s;
}

function indexLineLabel(s: string, label: string): number {
  const lower = s.toLowerCase();
  const want = label.toLowerCase();
  if (lower.startsWith(want)) {
    return 0;
  }
  const i = lower.indexOf(`\n${want}`);
  if (i < 0) {
    return -1;
  }
  return i + 1;
}

function splitLedger(s: string): { facts: string; voice: string; hasVoice: boolean } {
  const text = s.trim();
  if (text === "") {
    return { facts: "", voice: "", hasVoice: false };
  }
  const voiceAt = indexLineLabel(text, voiceLabel);
  if (voiceAt < 0) {
    if (indexLineLabel(text, factsLabel) === 0) {
      return { facts: text.slice(factsLabel.length).trim(), voice: "", hasVoice: false };
    }
    return { facts: text, voice: "", hasVoice: false };
  }
  const head = text.slice(0, voiceAt).trim();
  const voice = text.slice(voiceAt + voiceLabel.length).trim();
  const facts = indexLineLabel(head, factsLabel) === 0
    ? head.slice(factsLabel.length).trim()
    : head;
  return { facts, voice, hasVoice: true };
}

/** Keeps a Facts:/Voice: shape when a small model forgets the labels. */
function ensureVoiceLedger(prior: string, out: string): string {
  const next = splitLedger(out);
  let voice = next.voice;
  if (!next.hasVoice || voice.trim() === "") {
    const prev = splitLedger(prior);
    if (prev.hasVoice && prev.voice.trim() !== "") {
      voice = prev.voice.trim();
    }
  }
  const facts = next.facts;
  if (facts.trim() === "" && voice.trim() === "") {
    return out.trim();
  }
  if (voice.trim() === "") {
    return `${factsLabel} ${facts.trim()}`;
  }
  if (facts.trim() === "") {
    return `${voiceLabel} ${voice.trim()}`;
  }
  return `${factsLabel} ${facts.trim()}\n${voiceLabel} ${voice.trim()}`;
}

/** Facts and Voice. An unlabeled legacy paragraph comes back as facts only. */
export function ledgerParts(s: string): { facts: string; voice: string } {
  const parts = splitLedger(s);
  return { facts: parts.facts.trim(), voice: parts.voice.trim() };
}

function normalizeVoice(s: string): string {
  return s.toLowerCase().split(/\s+/u).filter((part) => part !== "").join(" ");
}

/** One-off register ("dry today") that distill already refuses for SELF.md. */
function isMoodWeather(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed === "") {
    return true;
  }
  if (trimmed.includes("\"")) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  for (const keep of ["gag", "joke", "nickname", "game", "ritual", "calls ", " is \""]) {
    if (lower.includes(keep)) {
      return false;
    }
  }
  return trimmed.split(/\s+/u).filter((part) => part !== "").length <= 3;
}

function splitVoiceSemi(s: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inQuote = false;
  for (const ch of s) {
    if (ch === "\"") {
      inQuote = !inQuote;
      buf += ch;
      continue;
    }
    if (ch === ";" && !inQuote) {
      const t = buf.trim();
      if (t !== "") {
        out.push(t);
      }
      buf = "";
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail !== "") {
    out.push(tail);
  }
  if (out.length === 0) {
    const whole = s.trim();
    return whole === "" ? [] : [whole];
  }
  return out;
}

/** Splits a Voice body on newlines and semicolons, keeping quoted jokes intact. */
export function voiceBits(s: string): string[] {
  const text = s.trim();
  if (text === "") {
    return [];
  }
  const bits: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    bits.push(...splitVoiceSemi(trimmed));
  }
  return bits;
}

/**
 * New Voice bits in `next` that were not in `prior`. Empty when Voice was
 * copied forward, or the only addition is mood weather. One line, for a
 * self-note append.
 */
export function voiceDelta(prior: string, next: string): string {
  const priorVoice = ledgerParts(prior).voice;
  const nextVoice = ledgerParts(next).voice;
  if (nextVoice.trim() === "") {
    return "";
  }
  if (normalizeVoice(nextVoice) === normalizeVoice(priorVoice)) {
    return "";
  }
  const have = new Set(voiceBits(priorVoice).map((bit) => normalizeVoice(bit)));
  const added: string[] = [];
  for (const bit of voiceBits(nextVoice)) {
    if (bit === "" || have.has(normalizeVoice(bit)) || isMoodWeather(bit)) {
      continue;
    }
    added.push(bit);
  }
  return added.join("; ");
}

function foldPrompt(prior: string, dropped: readonly Message[]): string {
  let b = "";
  if (prior.trim() !== "") {
    b += "Prior summary:\n";
    b += clipText(prior.trim(), maxSummaryChars);
    b += "\n\n";
  }
  b += "Dropped turns:\n";
  for (const m of dropped) {
    if (b.length >= maxFoldTotalChars) {
      b += "…[additional dropped turns omitted]\n";
      break;
    }
    b += `${m.role}: ${clipText(m.content, maxFoldMsgChars)}\n`;
  }
  return b;
}

/** Cheap compression pass over dropped turns. */
export class LlmSummarizer {
  constructor(private readonly completer: ChatProvider) {}

  async fold(prior: string, dropped: readonly Message[]): Promise<string> {
    if (dropped.length === 0) {
      return prior;
    }
    const res = await this.completer.complete({
      messages: [
        { role: "system", content: summarizeSystem },
        { role: "user", content: foldPrompt(prior, dropped) },
      ],
    });
    const out = res.content.trim();
    if (out === "") {
      throw new Error("session: empty summary from model");
    }
    return clipText(ensureVoiceLedger(prior, out), maxSummaryChars);
  }
}
