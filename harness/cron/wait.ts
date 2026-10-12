import { FollowUpDelaysMs, KindFollowUp, MaxWaitNudges, NoWaitToken, WaitToken } from "./constants";
import { FollowUpTurnMarker, followUpFormat } from "./prompts";
import { stripReact } from "./react";
import { stripBareToken, stripIncompleteWaitLine } from "./tokens";
import { formatRfc3339Nano } from "./time";
import type { Parsed } from "./types";

export function followUpPrefix(nudge: number, maxNudges: number): string {
  const max = maxNudges < 1 ? MaxWaitNudges : maxNudges;
  return followUpFormat
    .replace("%s", FollowUpTurnMarker)
    .replace("%d", String(nudge + 1))
    .replace("%d", String(max));
}

export function isFollowUpTurn(userText: string): boolean {
  return userText.trimStart().startsWith(FollowUpTurnMarker);
}

export function followUpParsed(at: number, tz: string): Parsed {
  return { kind: KindFollowUp, expr: formatRfc3339Nano(at), nextRun: at, timezone: tz };
}

/** Pause before the next poke. Null when the campaign is exhausted. `nudges` is the count already sent. */
export function nextFollowUpDelay(nudges: number): number | null {
  if (nudges < 0 || nudges >= FollowUpDelaysMs.length) return null;
  return FollowUpDelaysMs[nudges] ?? null;
}

export function hasWaitToken(s: string): boolean {
  return stripBareToken(s, WaitToken).found;
}

export function hasNoWaitToken(s: string): boolean {
  return stripBareToken(s, NoWaitToken).found;
}

/** Drops `[wait]` / `[nowait]` / `[react …]` so the human never sees them. */
export function stripWaitTokens(s: string): string {
  const waited = stripBareToken(s, WaitToken).text;
  const cleared = stripBareToken(waited, NoWaitToken).text;
  return stripReact(cleared);
}

/** Streaming drafts: hide a trailing incomplete `[wait]` / `[nowait]` / `[react`. */
export function stripWaitTokensLive(s: string): string {
  return stripIncompleteWaitLine(stripWaitTokens(s));
}
