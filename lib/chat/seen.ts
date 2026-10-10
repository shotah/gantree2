import type { Role, WireFrame } from "./frame";

/**
 * A phone `ack` with `seen: true`: the human has the thread on screen on
 * that mouth. The mailbox copies it to the same human's other sockets so
 * Cab (and Helm) can drop their notification cards. Plain acks are
 * delivery — Cab acks from a background service and on every sweep — and
 * are never copied. Returns the frame to fan, or nothing.
 */
export function seenAckFor(role: Role, frame: WireFrame, userId?: string): WireFrame | undefined {
  const sub = userId?.trim() ?? "";
  if (role !== "phone" || frame.kind !== "ack" || frame.seen !== true || !sub) {
    return undefined;
  }
  const out: WireFrame = { kind: "ack", seen: true, user_id: sub };
  if (frame.since) {
    out.since = frame.since;
  }
  if (frame.id) {
    out.id = frame.id;
  }
  return out;
}

/** An ack with nothing to acknowledge — a bare `seen` from a mouth with no cursor yet. Not for the crane. */
export function bareAck(frame: WireFrame): boolean {
  return frame.kind === "ack" && !frame.since && !frame.id;
}

export type SeenAck = { kind: "ack"; since?: string; id?: string; seen: true };

/**
 * What a phone sends on connect with the thread on screen: its cursor,
 * marked seen. With no cursor yet it is a bare seen — the mailbox copies it
 * to siblings and does not bother the crane.
 */
export function connectSeenAck(since?: string): SeenAck {
  return since ? { kind: "ack", since, seen: true } : { kind: "ack", seen: true };
}

/**
 * A live `reply` / `push` painted while the thread is on screen: ack it as
 * seen so the human's other mouths drop the card they just posted for it.
 * Hydrate (`replay`) is not reading; a turn with no id has nothing to name.
 */
export function seenAckForTurn(
  frame: { kind?: string; id?: string; replay?: boolean },
  threadVisible: boolean,
): SeenAck | undefined {
  if (!threadVisible || frame.replay === true || !frame.id) {
    return undefined;
  }
  if (frame.kind !== "reply" && frame.kind !== "push") {
    return undefined;
  }
  return { kind: "ack", id: frame.id, seen: true };
}
