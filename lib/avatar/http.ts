import { me, type DoorEnv } from "@/lib/door/http";
import type { UserStore } from "@/lib/door/users";
import { bearerForSlug, bearerMatches, fetchRoomBearer, parseBearers } from "@/lib/chat/bearer";
import { blobEtag, blobResponse, etagMatches } from "@/lib/chat/blob";
import { headerSaysTooLarge } from "@/lib/chat/caps";
import { configError, forbidden, unauthorized } from "@/lib/chat/deny";
import {
  humanChatPrecheck,
  memberInDirectory,
  memberRoomUsersWhenNeeded,
  slugInInventory,
} from "@/lib/chat/admission";
import type { DirectoryKv } from "@/lib/chat/directory";
import { agentStub, type AgentBinding } from "@/lib/chat/location";
import { phoneAdmitted } from "@/lib/chat/floor";
import type { Role } from "@/lib/door/users";
import { bearerToken } from "@/lib/chat/session";
import { parseSlug } from "@/lib/chat/slug";
import { fromStub } from "@/lib/chat/slugRoute";
import { acceptJpeg, AVATAR_MAX_BYTES } from "./jpeg";

export { blobEtag, blobResponse, etagMatches };
export { avatarRequestPath, blobRequestPath } from "./path";
export type { BlobRequestOpts } from "./path";

/** Forward the browser's validator to the Durable Object so it can answer 304. */
export function conditionalHeaders(req: Request): Record<string, string> {
  const tag = req.headers.get("If-None-Match");
  return tag ? { "If-None-Match": tag } : {};
}

/**
 * Harness `.env` `CHAT_MAILBOX_URL` (`wss://…/ws/kit`) → Worker face POST.
 * Same job as Telegram `setMyProfilePhoto`, different mouth.
 */
export function mailboxToAvatarUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol === "wss:") {
    u.protocol = "https:";
  } else if (u.protocol === "ws:") {
    u.protocol = "http:";
  } else if (u.protocol !== "http:" && u.protocol !== "https:") {
    return null;
  }
  const parts = u.pathname.split("/").filter(Boolean);
  const slug = parts[0] === "ws" ? parseSlug(parts[1] ?? "") : parseSlug(u.searchParams.get("slug") ?? "");
  if (!slug) {
    return null;
  }
  u.pathname = "/api/chat/avatar";
  u.search = "";
  u.hash = "";
  u.searchParams.set("slug", slug);
  return u.toString();
}

export type UploadCap = { maxBytes: number; tooLarge: string };
export type UploadResult = { ok: true; bytes: Uint8Array } | { ok: false; detail: string };

const AVATAR_CAP: UploadCap = { maxBytes: AVATAR_MAX_BYTES, tooLarge: "image too large (max 5MB)" };

export async function readAvatarUpload(req: Request): Promise<UploadResult> {
  return readJpegUpload(req, AVATAR_CAP);
}

/** Raw body or multipart `file`, refused past `cap` before buffering when the length is declared. */
export async function readJpegUpload(req: Request, cap: UploadCap): Promise<UploadResult> {
  if (headerSaysTooLarge(req.headers.get("content-length"), cap.maxBytes)) {
    return { ok: false, detail: cap.tooLarge };
  }
  const ctype = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ctype.includes("multipart/form-data")) {
    return fileFromForm(req, cap);
  }
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength > cap.maxBytes) {
      return { ok: false, detail: cap.tooLarge };
    }
    if (bytes.byteLength) {
      return { ok: true, bytes };
    }
  } catch {
    /* try form */
  }
  return fileFromForm(req, cap);
}

async function fileFromForm(req: Request, cap: UploadCap): Promise<UploadResult> {
  try {
    const form = await req.formData();
    const row = form.get("file");
    if (!(row instanceof Blob)) {
      return { ok: false, detail: "file required" };
    }
    if (row.size > cap.maxBytes) {
      return { ok: false, detail: cap.tooLarge };
    }
    const bytes = new Uint8Array(await row.arrayBuffer());
    if (bytes.byteLength > cap.maxBytes) {
      return { ok: false, detail: cap.tooLarge };
    }
    return { ok: true, bytes };
  } catch {
    return { ok: false, detail: "multipart file required" };
  }
}

export type ChatUser = {
  sub: string;
  email: string | null;
  role: string;
  agents: string[];
};

export type RoomEnv = DoorEnv & AgentBinding & {
  ALLOWED_SUBS?: string;
  SETTINGS?: DurableObjectNamespace;
  DIRECTORY?: DirectoryKv;
  /** `kit:token,ada:token` — env map of room bearers. The DO row wins when this slug is absent. */
  AGENT_BEARERS?: string;
};

type RoomStub = NonNullable<ReturnType<typeof agentStub>>;

export function slugFromRequest(req: Request): string | null {
  return parseSlug(new URL(req.url).searchParams.get("slug") ?? "");
}

/** Identity from the door. `me()` returns the response, so a miss is that response. */
export async function readChatUser(
  req: Request,
  env: DoorEnv,
  store: UserStore,
): Promise<{ user: ChatUser } | { response: Response }> {
  const res = await me(req, env, store);
  if (res.status !== 200) {
    return { response: res };
  }
  const body = await res.json<Partial<ChatUser>>();
  if (typeof body.sub !== "string" || !body.sub) {
    return { response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const agents = Array.isArray(body.agents) ? body.agents.filter((s): s is string => typeof s === "string") : [];
  return {
    user: {
      sub: body.sub,
      email: typeof body.email === "string" ? body.email : null,
      role: typeof body.role === "string" ? body.role : "member",
      agents,
    },
  };
}

/**
 * The harness on its own room. `Authorization: Bearer` is the room bearer
 * (`AGENT_BEARERS` map, else the Agent DO row) — the same token the socket
 * dials with. Header only; a bearer that does not match is 401, never a
 * fall-through to the cookie door.
 */
async function admitAgent(
  env: RoomEnv,
  slug: string,
  presented: string,
): Promise<{ user: ChatUser; stub: RoomStub } | { response: Response }> {
  if (!(await slugInInventory(env, slug))) {
    return { response: Response.json({ error: "not_found" }, { status: 404 }) };
  }
  const stub = agentStub(env, slug);
  if (!stub) {
    return { response: configError() };
  }
  const ok = bearerForSlug(parseBearers(env.AGENT_BEARERS), slug, presented)
    || bearerMatches(await fetchRoomBearer(stub), presented);
  if (!ok) {
    return { response: unauthorized() };
  }
  return { user: { sub: `agent:${slug}`, email: null, role: "agent", agents: [slug] }, stub };
}

/**
 * Signed-in caller who is on this room's list, or the harness with the room
 * bearer. No `AGENT` binding yet → 503.
 * TODO: `me()` does not take a slug; the room list on the Agent DO is the second check.
 */
export async function admitRoom(
  req: Request,
  env: RoomEnv,
  store: UserStore,
  slug: string,
): Promise<{ user: ChatUser; stub: RoomStub } | { response: Response }> {
  const presented = bearerToken(req.headers.get("Authorization"));
  if (presented) {
    return admitAgent(env, slug, presented);
  }
  const who = await readChatUser(req, env, store);
  if ("response" in who) {
    return who;
  }
  if (!(await slugInInventory(env, slug))) {
    return { response: Response.json({ error: "not_found" }, { status: 404 }) };
  }
  const doorRole = who.user.role as Role;
  const session = {
    sub: who.user.sub,
    email: who.user.email ?? undefined,
    emailVerified: Boolean(who.user.email),
  };
  const pre = humanChatPrecheck(env, { role: doorRole, agents: who.user.agents }, slug, session);
  if (pre === "forbidden") {
    return { response: forbidden() };
  }
  const inDirectory = doorRole === "member" && await memberInDirectory(env, session, slug);
  const list = await memberRoomUsersWhenNeeded(env, slug, doorRole, inDirectory);
  const allowed = phoneAdmitted(list, session, env, {
    role: doorRole,
    assignedSlugs: who.user.agents,
    slug,
    inDirectory,
  });
  if (!allowed) {
    return { response: forbidden() };
  }
  const stub = agentStub(env, slug);
  if (!stub) {
    return { response: configError() };
  }
  return { user: who.user, stub };
}

function jpegBody(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

/** GET/POST `/api/chat/avatar?slug=`. Bytes live on the Agent DO. */
export async function handleAvatar(req: Request, env: RoomEnv, store: UserStore): Promise<Response> {
  const slug = slugFromRequest(req);
  if (!slug) {
    return Response.json({ error: "bad slug" }, { status: 400 });
  }
  const admitted = await admitRoom(req, env, store, slug);
  if ("response" in admitted) {
    return admitted.response;
  }
  if (req.method === "GET") {
    return fromStub(await admitted.stub.fetch(new Request("https://agent/avatar", {
      method: "GET",
      headers: { "X-Chat-Op": "avatar", ...conditionalHeaders(req) },
    })));
  }
  if (req.method === "POST") {
    const got = await readAvatarUpload(req);
    if (!got.ok) {
      return Response.json({ error: got.detail }, { status: 400 });
    }
    const check = acceptJpeg(got.bytes);
    if (!check.ok) {
      return Response.json({ error: check.detail }, { status: 400 });
    }
    return fromStub(await admitted.stub.fetch(new Request("https://agent/avatar", {
      method: "PUT",
      headers: { "X-Chat-Op": "avatar", "Content-Type": "image/jpeg" },
      body: jpegBody(got.bytes),
    })));
  }
  return new Response("method", { status: 405 });
}
