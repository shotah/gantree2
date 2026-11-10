import type { Role } from "@/lib/door/users";
import type { RoomUser } from "./allow";
import type { ChatAuthEnv } from "./env";
import { roomAllows, type RoomSession } from "./room";

export type PhoneAdmitEnv = Pick<ChatAuthEnv, "ALLOWED_SUBS">;

export type PhoneAdmitCtx = {
  role: Role;
  /** Operator console assignment. Chat does not use it; Who can chat does. */
  assignedSlugs: readonly string[];
  slug: string;
};

/** Room list only — not `GANTREE_ALLOW` (sign-in only), not the DIRECTORY index. */
export function phoneAdmitted(
  roomUsers: readonly RoomUser[] | undefined,
  session: RoomSession,
  env: PhoneAdmitEnv,
  _ctx: PhoneAdmitCtx,
): boolean {
  return roomAllows(roomUsers, session, env.ALLOWED_SUBS);
}
