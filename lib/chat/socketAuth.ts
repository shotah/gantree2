import { roomAllows, type RoomSession } from "./room";
import type { RoomUser } from "./allow";
import type { Role } from "./frame";

/** Decimal millisecond expiry from `X-Chat-Exp`. Absent / junk → skip the exp check. */
export function parseExpMs(raw: string | undefined): number | undefined {
  if (!raw || !/^[0-9]+$/.test(raw)) {
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return undefined;
  }
  return n;
}

export function parseEmailVerified(raw: string | undefined): boolean {
  return raw === "1";
}

export type SocketAuthInput = {
  role: Role;
  userId?: string;
  email?: string;
  emailVerified?: boolean;
  expMs?: number;
  allowedSubs?: string;
  roomUsers?: RoomUser[];
  /** Google is on — empty room + no extra admits nobody. Spike skips. */
  enforce?: boolean;
  now: number;
};

function phoneSession(input: SocketAuthInput): RoomSession | null {
  if (!input.userId) {
    return null;
  }
  return {
    sub: input.userId,
    email: input.email,
    emailVerified: input.emailVerified,
  };
}

/**
 * Phone sockets re-check the room list (and optional static extra) on
 * every frame when Google is on. Spike and crane skip. Does not log sub.
 */
export function socketMessageAllowed(input: SocketAuthInput): boolean {
  if (input.role !== "phone") {
    return true;
  }
  if (!input.enforce) {
    return true;
  }
  const session = phoneSession(input);
  if (!session || !roomAllows(input.roomUsers, session, input.allowedSubs)) {
    return false;
  }
  if (input.expMs != null && input.expMs > 0 && input.now > input.expMs) {
    return false;
  }
  return true;
}
