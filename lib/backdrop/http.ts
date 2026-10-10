import { acceptJpeg } from "@/lib/avatar/jpeg";
import {
  admitRoom,
  blobRequestPath,
  conditionalHeaders,
  readJpegUpload,
  slugFromRequest,
  type BlobRequestOpts,
  type RoomEnv,
  type UploadResult,
} from "@/lib/avatar/http";
import { fromStub } from "@/lib/chat/slugRoute";
import type { UserStore } from "@/lib/door/users";
import { BACKDROP_MAX_BYTES, BACKDROP_TOO_LARGE } from "./store";

/** `/api/chat/backdrop?slug=kit&v=<rev>` — relative, for same-origin fetch. */
export function backdropRequestPath(opts: BlobRequestOpts): string {
  return blobRequestPath("/api/chat/backdrop", opts);
}

export async function readBackdropUpload(req: Request): Promise<UploadResult> {
  return readJpegUpload(req, { maxBytes: BACKDROP_MAX_BYTES, tooLarge: BACKDROP_TOO_LARGE });
}

function jpegBody(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

/** GET/POST/DELETE `/api/chat/backdrop?slug=`. Bytes live on the Agent DO. */
export async function handleBackdrop(req: Request, env: RoomEnv, store: UserStore): Promise<Response> {
  const slug = slugFromRequest(req);
  if (!slug) {
    return Response.json({ error: "bad slug" }, { status: 400 });
  }
  const admitted = await admitRoom(req, env, store, slug);
  if ("response" in admitted) {
    return admitted.response;
  }
  const headers = { "X-Chat-Op": "backdrop", ...conditionalHeaders(req) };
  if (req.method === "GET") {
    return fromStub(await admitted.stub.fetch(new Request("https://agent/backdrop", { method: "GET", headers })));
  }
  if (req.method === "DELETE") {
    return fromStub(await admitted.stub.fetch(new Request("https://agent/backdrop", {
      method: "DELETE",
      headers: { "X-Chat-Op": "backdrop" },
    })));
  }
  if (req.method === "POST") {
    const got = await readBackdropUpload(req);
    if (!got.ok) {
      return Response.json({ error: got.detail }, { status: 400 });
    }
    const check = acceptJpeg(got.bytes);
    if (!check.ok) {
      return Response.json({ error: check.detail }, { status: 400 });
    }
    return fromStub(await admitted.stub.fetch(new Request("https://agent/backdrop", {
      method: "PUT",
      headers: { "X-Chat-Op": "backdrop", "Content-Type": "image/jpeg" },
      body: jpegBody(got.bytes),
    })));
  }
  return new Response("method", { status: 405 });
}
