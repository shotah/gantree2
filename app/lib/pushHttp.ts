import { admitRoom, readChatUser, slugFromRequest, type ChatUser, type RoomEnv } from "@/lib/avatar/http";
import { headerSaysTooLarge } from "@/lib/chat/caps";
import { readVapid, type VapidCreds } from "@/lib/chat/push/vapid";
import { parsePushDelete, parsePushPut, parsePushTest } from "@/lib/chat/push/subscription";
import { fromStub } from "@/lib/chat/slugRoute";
import type { UserStore } from "@/lib/door/users";

const PUSH_JSON_MAX = 8_192;

type PushEnv = RoomEnv & {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};

function tooLarge(): Response {
  return Response.json({ error: "too large" }, { status: 413 });
}

function badFrame(): Response {
  return Response.json({ error: "bad frame" }, { status: 400 });
}

function pushHeaders(user: ChatUser): Headers {
  const headers = new Headers({
    "X-Chat-Op": "push",
    "X-Chat-Sub": user.sub,
    "Content-Type": "application/json",
  });
  if (user.email) {
    headers.set("X-Chat-Email", user.email);
    // The door only seals a session after Google says the email is verified.
    headers.set("X-Chat-EmailVerified", "1");
  }
  return headers;
}

async function readJson(req: Request): Promise<{ raw: unknown } | { response: Response }> {
  if (headerSaysTooLarge(req.headers.get("content-length"), PUSH_JSON_MAX)) {
    return { response: tooLarge() };
  }
  let buf: ArrayBuffer;
  try {
    buf = await req.arrayBuffer();
  } catch {
    return { response: badFrame() };
  }
  if (buf.byteLength > PUSH_JSON_MAX) {
    return { response: tooLarge() };
  }
  try {
    return { raw: JSON.parse(new TextDecoder().decode(buf)) as unknown };
  } catch {
    return { response: badFrame() };
  }
}

/** GET public key. PUT/DELETE/POST forward the subscription to the Agent DO. */
export async function handlePush(req: Request, env: PushEnv, store: UserStore): Promise<Response> {
  const vapid: VapidCreds | null = readVapid(env);
  if (!vapid) {
    return new Response(null, { status: 404 });
  }
  if (req.method === "GET") {
    const who = await readChatUser(req, env, store);
    if ("response" in who) {
      return who.response;
    }
    return Response.json({ publicKey: vapid.publicKey });
  }
  if (req.method !== "PUT" && req.method !== "DELETE" && req.method !== "POST") {
    return new Response("method", { status: 405 });
  }
  const body = await readJson(req);
  if ("response" in body) {
    return body.response;
  }
  const parsed = req.method === "PUT"
    ? parsePushPut(body.raw)
    : req.method === "DELETE"
      ? parsePushDelete(body.raw)
      : parsePushTest(body.raw);
  if (!parsed) {
    return badFrame();
  }
  const slug = slugFromRequest(new Request(`https://chat.local/api/chat/push?slug=${encodeURIComponent(parsed.slug)}`));
  if (!slug) {
    return badFrame();
  }
  const admitted = await admitRoom(
    new Request(req.url, { headers: req.headers }),
    env,
    store,
    slug,
  );
  if ("response" in admitted) {
    return admitted.response;
  }
  const headers = pushHeaders(admitted.user);
  const forwarded = JSON.stringify(parsed);
  if (forwarded.length > PUSH_JSON_MAX) {
    return tooLarge();
  }
  return fromStub(await admitted.stub.fetch(new Request("https://agent/push", {
    method: req.method,
    headers,
    body: forwarded,
  })));
}
