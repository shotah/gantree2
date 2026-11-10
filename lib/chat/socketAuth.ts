import { phoneAdmitted } from "./floor";
import type { RoomSession } from "./room";
import type { RoomUser } from "./allow";
import type { Role } from "./frame";
import type { Role as DoorRole } from "@/lib/door/users";

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
  doorRole?: DoorRole;
  assignedAgents?: readonly string[];
  slug?: string;
  /** Google is on — empty room + no extra admits nobody. Spike skips. */
  enforce?: boolean;
  now: number;
};

function phoneSession(input: SocketAuthInput): RoomSession | null {
  if (!input.userId) {
    return null;
  }
  const email = input.email?.trim();
  return {
    sub: input.userId,
    email: email || undefined,
    // The worker stamps an email only after the sealed session verified it.
    // A dropped verified tag must not close that socket on the next frame.
    emailVerified: input.emailVerified === true || Boolean(email),
  };
}

/** `unauthorized` closes 4401 (session no good); `forbidden` closes 4403 (not on the room list). */
export type SocketVerdict = "ok" | "unauthorized" | "forbidden";

/**
 * Phone sockets re-check floor env, room list, and optional static extra on
 * every frame when Google is on. Spike and crane skip. Does not log sub.
 */
export function socketMessageAllowed(input: SocketAuthInput): SocketVerdict {
  if (input.role !== "phone") {
    return "ok";
  }
  if (!input.enforce) {
    return "ok";
  }
  const session = phoneSession(input);
  if (!session || !input.doorRole || !input.slug) {
    return "unauthorized";
  }
  if (input.expMs != null && input.expMs > 0 && input.now > input.expMs) {
    return "unauthorized";
  }
  if (!phoneAdmitted(input.roomUsers, session, {
    ALLOWED_SUBS: input.allowedSubs,
  }, {
    role: input.doorRole,
    assignedSlugs: input.assignedAgents ?? [],
    slug: input.slug,
  })) {
    return "forbidden";
  }
  return "ok";
}
