import type { Role } from "@/lib/door/users";
import type { RoomUser } from "./allow";
import type { ChatAuthEnv } from "./env";
import { roomAllows, type RoomSession } from "./room";

export type PhoneAdmitEnv = Pick<ChatAuthEnv, "ALLOWED_SUBS">;

export type PhoneAdmitCtx = {
  role: Role;
  /** Operator assignment from the Settings row; ignored for admin and member. */
  assignedSlugs: readonly string[];
  slug: string;
  /** Member already indexed for this slug in DIRECTORY KV. */
  inDirectory?: boolean;
};

/** Settings role and room list — not `GANTREE_ALLOW` (sign-in only). */
export function phoneAdmitted(
  roomUsers: readonly RoomUser[] | undefined,
  session: RoomSession,
  env: PhoneAdmitEnv,
  ctx: PhoneAdmitCtx,
): boolean {
  if (ctx.role === "admin") {
    return true;
  }
  if (ctx.role === "operator") {
    return ctx.assignedSlugs.includes(ctx.slug);
  }
  if (ctx.inDirectory) {
    return true;
  }
  return roomAllows(roomUsers, session, env.ALLOWED_SUBS);
}
