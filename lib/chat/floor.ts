import { onList, parseAllowlist, type Identity } from "@/lib/door/allowlist";
import type { RoomUser } from "./allow";
import type { ChatAuthEnv } from "./env";
import { roomAllows, type RoomSession } from "./room";

export type FloorEnv = Pick<ChatAuthEnv, "GANTREE_ADMINS" | "GANTREE_ALLOW">;

export type PhoneAdmitEnv = Pick<ChatAuthEnv, "ALLOWED_SUBS" | "GANTREE_ADMINS" | "GANTREE_ALLOW">;

function identity(session: RoomSession): Identity {
  const email = session.email?.trim() ?? "";
  return {
    sub: session.sub,
    email: email || null,
    emailVerified: session.emailVerified === true && Boolean(email),
  };
}

/** `GANTREE_ADMINS` ∪ `GANTREE_ALLOW`, same grammar and matching as the app door. */
export function deploymentFloorAllows(env: FloorEnv, session: RoomSession): boolean {
  if (!session.sub) {
    return false;
  }
  const who = identity(session);
  const floor = [...parseAllowlist(env.GANTREE_ADMINS), ...parseAllowlist(env.GANTREE_ALLOW)];
  return onList(floor, who);
}

/** Floor env vars or the agent's room list (and optional static extra). */
export function phoneAdmitted(
  roomUsers: readonly RoomUser[] | undefined,
  session: RoomSession,
  env: PhoneAdmitEnv,
): boolean {
  if (deploymentFloorAllows(env, session)) {
    return true;
  }
  return roomAllows(roomUsers, session, env.ALLOWED_SUBS);
}
