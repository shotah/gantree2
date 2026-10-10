import type { Role, WireFrame } from "./frame";

/**
 * Emoji reactions, both ways (crane `docs/reactions.md`; contract in
 * docs/frontends.md → Reactions). One frame shape on the wire:
 *
 *   { kind: "react", user_id, id: <message id>, text: "👍" }
 *
 * `id` names the bubble reacted to — the human's `inbound` id when Kit
 * reacts, Kit's `reply` / `push` id when the human does. `text` is the
 * emoji set (space-separated, the crane reads `strings.Fields`); empty
 * text clears. Not a turn: no `seq`, no queue, no Web Push, no cursor
 * move. Stored per human by message id so hydrate paints it back.
 */

/** What the picker shows and what the model may react with. Same list as crane `channel.Palette`. */
export const REACTION_PALETTE = ["👍", "👎", "❤️", "🔥", "🤣", "😢", "🤔", "🙏", "👀", "🎉", "💯", "👏"] as const;

/** A reaction is a few emoji at most. Bytes, UTF-8. */
export const REACTION_TEXT_MAX = 64;

/** Per-human reactions kept for hydrate; pruned to the transcript, hard-capped here. */
export const REACTIONS_MAX = 200;

export const REACTIONS_STORE_PREFIX = "r:";

export function reactionsStoreKey(userId: string): string {
  return REACTIONS_STORE_PREFIX + userId.trim();
}

/** Message id → emoji set. */
export type Reactions = Record<string, string>;

/**
 * Normalize a reaction's text: trimmed, single-spaced, no control
 * characters, within the byte cap. `""` is a clear. `undefined` is junk.
 */
export function parseReactionText(raw: unknown): string | undefined {
  if (raw == null) {
    return "";
  }
  if (typeof raw !== "string") {
    return undefined;
  }
  const text = raw.split(/\s+/u).filter(Boolean).join(" ");
  if (!text) {
    return "";
  }
  // Control / format characters are junk — except the two that glue emoji
  // together (ZWJ) and pick their presentation (VS16, as in ❤️).
  for (const ch of text) {
    if (ch === "\u200d" || ch === "\ufe0f") {
      continue;
    }
    if (/[\p{Cc}\p{Cf}]/u.test(ch)) {
      return undefined;
    }
  }
  if (new TextEncoder().encode(text).byteLength > REACTION_TEXT_MAX) {
    return undefined;
  }
  return text;
}

/** `userId` is empty only for a spike phone (no Google sub): fanned to the crane, never stored. */
export type Reaction = { userId: string; id: string; text: string };

/**
 * A `react` frame as the mailbox will carry it, or nothing when it is not
 * well-formed. A phone's `user_id` is the socket's stamp (already on the
 * frame by the time this runs); the crane must name the human.
 */
export function reactionFor(role: Role, frame: WireFrame): Reaction | undefined {
  if (frame.kind !== "react") {
    return undefined;
  }
  const id = frame.id?.trim() ?? "";
  const userId = frame.user_id?.trim() ?? "";
  const text = parseReactionText(frame.text);
  if (!id || text === undefined || (role === "crane" && !userId)) {
    return undefined;
  }
  return { userId, id, text };
}

/** The crane's reaction is a few bytes beside a reply; it does not spend the turn bucket. */
export function agentPublishedReact(role: Role, kind?: string): boolean {
  return role === "crane" && kind === "react";
}

export function encodeReaction(r: Reaction, replay = false): WireFrame {
  const out: WireFrame = { kind: "react", id: r.id, text: r.text };
  if (r.userId) {
    out.user_id = r.userId;
  }
  if (replay) {
    out.replay = true;
  }
  return out;
}

export function asReactions(raw: unknown): Reactions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Reactions = {};
  for (const [id, text] of Object.entries(raw as Record<string, unknown>)) {
    if (id && typeof text === "string" && text) {
      out[id] = text;
    }
  }
  return out;
}

/**
 * Set or clear one message's reaction, then keep only ids the transcript
 * still has (a reaction on a bubble hydrate will never paint is dead
 * weight) and at most `max` newest by insertion.
 */
export function applyReaction(
  cur: Reactions,
  r: Reaction,
  keepIds: ReadonlySet<string>,
  max = REACTIONS_MAX,
): Reactions {
  const next: Reactions = {};
  for (const [id, text] of Object.entries(cur)) {
    if (id !== r.id && keepIds.has(id)) {
      next[id] = text;
    }
  }
  if (r.text && keepIds.has(r.id)) {
    next[r.id] = r.text;
  }
  const ids = Object.keys(next);
  if (ids.length > max) {
    for (const id of ids.slice(0, ids.length - max)) {
      delete next[id];
    }
  }
  return next;
}

/** Hydrate: one `react` per stored reaction whose bubble was just replayed, in thread order. */
export function reactionFramesFor(
  userId: string,
  reactions: Reactions,
  replayedIds: readonly string[],
): WireFrame[] {
  const out: WireFrame[] = [];
  for (const id of replayedIds) {
    const text = reactions[id];
    if (text) {
      out.push(encodeReaction({ userId, id, text }, true));
    }
  }
  return out;
}

/** Tap the emoji you already set and it clears; anything else replaces. */
export function toggleReaction(current: string | undefined, emoji: string): string {
  return current === emoji ? "" : emoji;
}
