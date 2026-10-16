import { devIdentity } from "@/lib/door/gate";
import { memoryStore } from "@/lib/door/users";
import type { UserStore } from "@/lib/door/users";
import {
  doorUserForRequest,
  humanChatPrecheck,
  memberInDirectory,
  memberRoomUsersWhenNeeded,
  inventoriedAgent,
} from "./admission";
import type { RoomUser } from "./allow";
import { phoneAdmitted } from "./floor";
import { fetchRoomBearer } from "./bearer";
import { agentOff, configError, forbidden, unauthorized } from "./deny";
import type { AgentEnv } from "./env";
import { handshakeSlug } from "./handshake";
import { agentStub } from "./location";
import { parseSlug } from "./slug";

/** Per-slug room routes (`/api/avatar`, `/api/backdrop`, `/api/theme`, `/api/push`): same door. */

function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}

/** Null when the caller may touch this slug; otherwise the deny response. */
export async function authorizeSlug(
  env: AgentEnv,
  req: Request,
  slug: string,
  store: UserStore = memoryStore(),
): Promise<Response | null> {
  const row = await inventoriedAgent(env, slug);
  if (!row) {
    return notFound();
  }
  if (!row.enabled) {
    return agentOff();
  }
  const url = new URL(req.url);
  const who = await doorUserForRequest(env, req, store);
  let roomList: readonly RoomUser[] = [];
  let roomBearer: string | null = null;
  let admit: Parameters<typeof handshakeSlug>[0]["admit"];

  const authHeader = req.headers.get("Authorization") ?? "";
  const presentedBearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : url.searchParams.get("bearer")?.trim() ?? "";
  if (!who && presentedBearer) {
    const stub = agentStub(env, slug);
    roomBearer = stub ? await fetchRoomBearer(stub) : null;
  }

  if (who) {
    const session = {
      sub: who.entry.sub ?? "",
      email: who.entry.email ?? undefined,
      emailVerified: Boolean(who.entry.email),
    };
    const pre = humanChatPrecheck(env, who, slug, session);
    if (pre === "forbidden") {
      return forbidden();
    }
    const inDirectory = await memberInDirectory(env, session, slug);
    roomList = await memberRoomUsersWhenNeeded(env, slug, who.role, inDirectory);
    admit = { role: who.role, assignedSlugs: who.agents, slug, inDirectory };
  }

  if (devIdentity(env, url) && who) {
    const session = {
      sub: who.entry.sub ?? "",
      email: who.entry.email ?? undefined,
      emailVerified: Boolean(who.entry.email),
    };
    const ctx = admit ?? {
      role: who.role,
      assignedSlugs: who.agents,
      slug,
      inDirectory: await memberInDirectory(env, session, slug),
    };
    return phoneAdmitted(roomList, session, env, ctx) ? null : forbidden();
  }

  const auth = await handshakeSlug({
    env,
    slug,
    cookieHeader: req.headers.get("Cookie"),
    authorization: req.headers.get("Authorization"),
    querySecret: url.searchParams.get("secret"),
    queryBearer: url.searchParams.get("bearer"),
    roomList,
    roomBearer,
    host: url.hostname,
    admit,
  });
  if (auth.ok) {
    return null;
  }
  if (auth.error === "config") {
    return configError();
  }
  if (auth.error === "forbidden") {
    return forbidden();
  }
  return unauthorized();
}

export async function withSlug(
  env: AgentEnv,
  req: Request,
  next: (slug: string, stub: DurableObjectStub) => Promise<Response>,
  store: UserStore = memoryStore(),
): Promise<Response> {
  const slug = parseSlug(new URL(req.url).searchParams.get("slug") ?? "");
  if (!slug) {
    return Response.json({ error: "bad slug" }, { status: 400 });
  }
  const denied = await authorizeSlug(env, req, slug, store);
  if (denied) {
    return denied;
  }
  const stub = agentStub(env, slug);
  if (!stub) {
    return configError();
  }
  return next(slug, stub);
}

/** Re-wrap a Durable Object response so the Worker owns the body stream. */
export async function fromStub(res: Response): Promise<Response> {
  const buf = await res.arrayBuffer();
  const headers = new Headers();
  res.headers.forEach((v, k) => {
    headers.set(k, v);
  });
  return new Response(buf.byteLength ? buf : null, { status: res.status, headers });
}
