import { devIdentity } from "@/lib/door/gate";
import { fetchRoomUsers } from "./allow";
import { fetchRoomBearer } from "./bearer";
import { configError, forbidden, unauthorized } from "./deny";
import type { AgentEnv } from "./env";
import { handshakeSlug } from "./handshake";
import { agentStub } from "./location";
import { parseSlug } from "./slug";

/** Per-slug room routes (`/api/avatar`, `/api/backdrop`, `/api/theme`, `/api/push`): same door. */

/** Null when the caller may touch this slug; otherwise the deny response. */
export async function authorizeSlug(env: AgentEnv, req: Request, slug: string): Promise<Response | null> {
  const url = new URL(req.url);
  if (devIdentity(env, url)) {
    return null;
  }
  const stub = agentStub(env, slug);
  const roomList = stub ? await fetchRoomUsers(stub) : [];
  const roomBearer = stub ? await fetchRoomBearer(stub) : null;
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
): Promise<Response> {
  const slug = parseSlug(new URL(req.url).searchParams.get("slug") ?? "");
  if (!slug) {
    return Response.json({ error: "bad slug" }, { status: 400 });
  }
  const denied = await authorizeSlug(env, req, slug);
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
