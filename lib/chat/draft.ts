import { hasText, type Role, type WireFrame } from "./frame";

export function phoneMustNotPublishDraft(role: Role, kind?: string): boolean {
  return role === "phone" && kind === "draft";
}

export function agentPublishedDraft(role: Role, kind?: string): boolean {
  return role === "crane" && kind === "draft";
}

/**
 * A `draft` with no words. The crane's only blank is `Discard` (cancel /
 * empty turn / error), so while a draft is held it is the "clear" and is
 * fanned; with nothing held it is noise and dropped. Ending a turn with
 * something to paint is still `reply` or `error`.
 */
export function blankDraft(frame: Pick<WireFrame, "text">): boolean {
  return !hasText(frame);
}

/** The frames that end an in-progress answer; the held draft for that human goes with them. */
export function clearsDraft(kind?: string): boolean {
  return kind === "reply" || kind === "error";
}

/**
 * A phone's draft bubble with no new words and no `typing` for this long is
 * a ghost (dead crane) and comes down. Same number as Cab `DRAFT_TTL_MS`.
 * An identical re-sent draft (the Worker's connect flush) is not life.
 */
export const DRAFT_TTL_MS = 60_000;

/** The Worker forgets a held draft on the same rule, so it never hands back what the phone already expired. */
export const HELD_DRAFT_TTL_MS = DRAFT_TTL_MS;

type Held = { text: string; at: number };

/**
 * Latest draft text per `sub` while Kit is mid-answer, so a phone that
 * redials mid-answer gets the bubble back on connect. Memory only, no
 * storage. `typing` is life, like it is on the phone. Expiry is lazy: the
 * connect flush is the only reader, so checking there is the same as a
 * timer without the alarm.
 */
export class HeldDrafts {
  private readonly rows = new Map<string, Held>();

  hold(sub: string, text: string, now: number): void {
    this.rows.set(sub, { text, at: now });
  }

  /** A `typing` for this human keeps the held draft alive through a tool call. */
  touch(sub: string, now: number): void {
    const held = this.rows.get(sub);
    if (held) {
      held.at = now;
    }
  }

  /** Forget this human's draft. True when one was held — a blank `draft` then means "clear". */
  drop(sub: string): boolean {
    return this.rows.delete(sub);
  }

  /** The crane went away mid-answer: nothing will finish these. */
  clear(): void {
    this.rows.clear();
  }

  /** What to hand a connecting phone, or nothing. A stale row is forgotten here. */
  current(sub: string, now: number): string | undefined {
    const held = this.rows.get(sub);
    if (!held) {
      return undefined;
    }
    if (now - held.at > HELD_DRAFT_TTL_MS) {
      this.rows.delete(sub);
      return undefined;
    }
    return held.text;
  }
}
