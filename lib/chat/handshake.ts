import { bearerForSlug, bearerMatches, parseBearers } from "./bearer";
import type { ChatAuthEnv } from "./env";
import type { RoomUser } from "./allow";
import type { Role } from "./frame";
import { type AuthMode, resolveAuthMode } from "./mode";
import { phoneAdmitted, type PhoneAdmitCtx } from "./floor";
import { secretEqual } from "./secret";
import { readChatSession } from "./session";

export type PhonePrincipal = {
  kind: "phone";
  sub: string;
  email?: string;
  emailVerified?: boolean;
  exp?: number;
};
/** Harness. The wire query role is still `crane`; this kind is the new name. */
export type AgentPrincipal = { kind: "agent"; slug: string };
export type SpikePrincipal = { kind: "spike"; role: Role };
export type Principal = PhonePrincipal | AgentPrincipal | SpikePrincipal;

export type HandshakeOk = { ok: true; principal: Principal };
export type HandshakeErr = { ok: false; error: "unauthorized" | "forbidden" | "config" };
export type HandshakeResult = HandshakeOk | HandshakeErr;

export type HandshakeInput = {
  env: ChatAuthEnv;
  slug: string;
  role: Role;
  cookieHeader?: string | null;
  authorization?: string | null;
  querySecret?: string | null;
  queryBearer?: string | null;
  now?: number;
  roomList?: readonly RoomUser[];
  /** Bearer stored on the Agent DO, used when `AGENT_BEARERS` has no row for this slug. */
  roomBearer?: string | null;
  host?: string;
  admit?: PhoneAdmitCtx;
  /** Allowlist email for this sub when the sealed session itself has none. */
  listedEmail?: string | null;
};

function bearerFrom(
  authorization: string | null | undefined,
  query: string | null | undefined,
  allowQuery: boolean,
): string {
  const header = authorization?.trim() ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  if (!allowQuery) {
    return "";
  }
  return query?.trim() ?? "";
}

async function phoneFromRequest(input: HandshakeInput, now: number): Promise<Awaited<ReturnType<typeof readChatSession>>> {
  const secret = input.env.SESSION_SECRET?.trim() ?? "";
  if (!secret) {
    return null;
  }
  return readChatSession(secret, {
    cookieHeader: input.cookieHeader,
    authorization: input.authorization,
  }, now);
}

/**
 * Authorize a socket. Unknown human and bad token look the same.
 * When Google is on, the spike secret is rejected.
 */
export async function handshake(input: HandshakeInput): Promise<HandshakeResult> {
  const mode = resolveAuthMode(input.env, input.host);
  if (!mode.ok) {
    return { ok: false, error: "config" };
  }
  const now = input.now ?? Date.now();
  if (mode.mode === "spike") {
    return spikeHandshake(input.env, input.role, input);
  }
  return oidcHandshake(input, now);
}

export type HandshakeSlugInput = Omit<HandshakeInput, "role">;

/** Phone socket: session (or spike) first, then load the room. Does not wake a DO on a missing cookie. */
export async function handshakePhone(
  input: HandshakeSlugInput & { loadRoom: () => Promise<RoomUser[]> },
): Promise<HandshakeResult> {
  const mode = resolveAuthMode(input.env, input.host);
  if (!mode.ok) {
    return { ok: false, error: "config" };
  }
  const now = input.now ?? Date.now();
  if (mode.mode === "spike") {
    return spikeHandshake(input.env, "phone", { ...input, role: "phone" });
  }
  const session = await phoneFromRequest({ ...input, role: "phone" }, now);
  if (!session) {
    return { ok: false, error: "unauthorized" };
  }
  const roomList = await input.loadRoom();
  return oidcHandshake({ ...input, role: "phone", roomList }, now);
}

/** HTTP face: phone cookie or harness bearer (or the spike secret). */
export async function handshakeSlug(input: HandshakeSlugInput): Promise<HandshakeResult> {
  const mode = resolveAuthMode(input.env, input.host);
  if (!mode.ok) {
    return { ok: false, error: "config" };
  }
  const now = input.now ?? Date.now();
  if (mode.mode === "spike") {
    return spikeHandshake(input.env, "phone", { ...input, role: "phone" });
  }
  const phone = await oidcHandshake({ ...input, role: "phone" }, now);
  if (phone.ok || phone.error === "forbidden") {
    return phone;
  }
  return oidcHandshake({ ...input, role: "crane" }, now);
}

function spikeHandshake(env: ChatAuthEnv, role: Role, input: HandshakeInput): HandshakeResult {
  const want = env.CHAT_SECRET?.trim() ?? "";
  const presented = bearerFrom(input.authorization, input.querySecret, true);
  if (!want || !presented || !secretEqual(want, presented)) {
    return { ok: false, error: "unauthorized" };
  }
  return { ok: true, principal: { kind: "spike", role } };
}

async function oidcHandshake(input: HandshakeInput, now: number): Promise<HandshakeResult> {
  if (input.role === "phone") {
    const session = await phoneFromRequest(input, now);
    if (!session) {
      return { ok: false, error: "unauthorized" };
    }
    const listed = input.listedEmail?.trim() ?? "";
    const email = session.email ?? (listed || undefined);
    const emailVerified = session.emailVerified || Boolean(listed && !session.email);
    if (!input.admit || !phoneAdmitted(input.roomList, {
      sub: session.sub,
      email,
      emailVerified,
    }, input.env, input.admit)) {
      return { ok: false, error: "forbidden" };
    }
    return {
      ok: true,
      principal: {
        kind: "phone",
        sub: session.sub,
        email,
        emailVerified,
        exp: session.exp,
      },
    };
  }
  const presented = bearerFrom(input.authorization, input.queryBearer, false);
  if (bearerForSlug(parseBearers(input.env.AGENT_BEARERS), input.slug, presented)) {
    return { ok: true, principal: { kind: "agent", slug: input.slug } };
  }
  if (bearerMatches(input.roomBearer, presented)) {
    return { ok: true, principal: { kind: "agent", slug: input.slug } };
  }
  return { ok: false, error: "unauthorized" };
}

/** `crane` is the harness wire name. `agent` is the same role. */
export function roleFromQuery(raw: string | null): Role | null {
  if (raw === "phone") {
    return "phone";
  }
  if (raw === "crane" || raw === "agent") {
    return "crane";
  }
  return null;
}

export function rateId(mode: AuthMode, principal: Principal): string {
  if (principal.kind === "phone") {
    return `sub:${principal.sub}`;
  }
  if (principal.kind === "agent") {
    return `bearer:${principal.slug}`;
  }
  return `spike:${principal.role}`;
}

export function stampUserId(principal: Principal): string | undefined {
  if (principal.kind === "phone") {
    return principal.sub;
  }
  if (principal.kind === "spike" && principal.role === "phone") {
    return "spike";
  }
  return undefined;
}

export function stampEmail(principal: Principal): string | undefined {
  if (principal.kind === "phone" && principal.email) {
    return principal.email;
  }
  return undefined;
}
