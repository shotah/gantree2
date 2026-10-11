/**
 * Moves new Voice quotes from a history fold into SELF.md, and puts quoted
 * bullets back when a distill flattens a joke into a vibe word.
 */
import { voiceBits, voiceDelta } from "@/brain/session/summary";
import type { SelfNoteStore } from "./store";
import { body } from "./stamp";

const graduateNoteMax = 200;

function quotedSpan(s: string): string {
  const i = s.indexOf("\"");
  if (i < 0) {
    return "";
  }
  const j = s.indexOf("\"", i + 1);
  if (j < 0) {
    return "";
  }
  return s.slice(i + 1, j);
}

function voiceAlreadyIn(selfLower: string, bit: string): boolean {
  const trimmed = bit.trim();
  if (trimmed === "") {
    return true;
  }
  if (selfLower.includes(trimmed.toLowerCase())) {
    return true;
  }
  const q = quotedSpan(trimmed);
  return q !== "" && selfLower.includes(q.toLowerCase());
}

function bitsNotInSelf(delta: string, self: string): string {
  const selfLower = self.toLowerCase();
  const keep: string[] = [];
  for (const bit of voiceBits(delta)) {
    if (voiceAlreadyIn(selfLower, bit)) {
      continue;
    }
    keep.push(bit);
  }
  return keep.join("; ");
}

function clipGraduateNote(s: string): string {
  const flat = s.trim().split(/\s+/u).filter((part) => part !== "").join(" ");
  if (flat.length <= graduateNoteMax) {
    return flat;
  }
  return `${flat.slice(0, graduateNoteMax - 1)}…`;
}

/**
 * Appends new Voice bits from a history fold. No model call — the fold already
 * decided what was tonal. Returns true when a line was written.
 */
export function graduateVoice(store: SelfNoteStore | null, prior: string, next: string): boolean {
  if (!store) {
    return false;
  }
  const delta = voiceDelta(prior, next);
  if (delta === "") {
    return false;
  }
  const note = bitsNotInSelf(delta, store.read());
  if (note === "") {
    return false;
  }
  store.append(clipGraduateNote(note));
  return true;
}

/**
 * Appends prior SELF.md bullets whose quoted spans are missing from `next`.
 * Header and blockquote lines are ignored. Empty prior is a no-op.
 */
export function restoreQuotedLines(prior: string, next: string): string {
  const priorBody = body(prior);
  if (priorBody === "") {
    return next;
  }
  const nextLower = next.toLowerCase();
  const missing: string[] = [];
  for (const rawLine of priorBody.split("\n")) {
    let line = rawLine.trim();
    if (line === "") {
      continue;
    }
    const q = quotedSpan(line);
    if (q === "") {
      continue;
    }
    if (nextLower.includes(q.toLowerCase())) {
      continue;
    }
    if (!line.startsWith("- ")) {
      line = `- ${line.replace(/^[- ]+/u, "")}`;
    }
    missing.push(line);
  }
  if (missing.length === 0) {
    return next;
  }
  return `${next.trim()}\n${missing.join("\n")}`;
}
