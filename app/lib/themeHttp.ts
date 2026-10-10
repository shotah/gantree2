import { admitRoom, slugFromRequest, type RoomEnv } from "@/lib/avatar/http";
import { fromStub } from "@/lib/chat/slugRoute";
import type { UserStore } from "@/lib/door/users";
import { parseThemeWrite } from "@/lib/theme/store";

/** GET/POST/DELETE `/api/chat/theme?slug=`. The Agent DO stores the room theme. */
export async function handleTheme(req: Request, env: RoomEnv, store: UserStore): Promise<Response> {
  const slug = slugFromRequest(req);
  if (!slug) {
    return Response.json({ error: "bad slug" }, { status: 400 });
  }
  const admitted = await admitRoom(req, env, store, slug);
  if ("response" in admitted) {
    return admitted.response;
  }
  if (req.method === "GET") {
    return fromStub(await admitted.stub.fetch(new Request("https://agent/theme", {
      method: "GET",
      headers: { "X-Chat-Op": "theme" },
    })));
  }
  if (req.method === "DELETE") {
    return fromStub(await admitted.stub.fetch(new Request("https://agent/theme", {
      method: "DELETE",
      headers: { "X-Chat-Op": "theme" },
    })));
  }
  if (req.method === "POST") {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return Response.json({ error: "bad theme" }, { status: 400 });
    }
    const got = parseThemeWrite(raw);
    if (!got.ok) {
      return Response.json({ error: got.detail }, { status: 400 });
    }
    return fromStub(await admitted.stub.fetch(new Request("https://agent/theme", {
      method: "PUT",
      headers: { "X-Chat-Op": "theme", "Content-Type": "application/json" },
      body: JSON.stringify({ theme: got.theme }),
    })));
  }
  return new Response("method", { status: 405 });
}
