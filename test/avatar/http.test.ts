import { describe, expect, it } from "vitest";
import {
  avatarRequestPath,
  blobEtag,
  blobResponse,
  conditionalHeaders,
  etagMatches,
  mailboxToAvatarUrl,
  readAvatarUpload,
} from "@/lib/avatar/http";

describe("blobResponse", () => {
  const hit = { jpeg: new Uint8Array([0xff, 0xd8, 0xff, 1]).buffer, rev: 1700 };

  it("serves the JPEG with rev, ETag, and no-store-ish cache headers", async () => {
    const res = blobResponse(hit, null);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("X-Chat-Rev")).toBe("1700");
    expect(res.headers.get("ETag")).toBe("\"1700\"");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=0, must-revalidate");
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0xff);
  });

  it("answers 304 with no body when If-None-Match already names this rev", async () => {
    const res = blobResponse(hit, blobEtag(1700));
    expect(res.status).toBe(304);
    expect(res.headers.get("X-Chat-Rev")).toBe("1700");
    expect(res.headers.get("ETag")).toBe("\"1700\"");
    expect(res.body).toBeNull();
  });

  it("sends the bytes again when the caller holds an older rev", () => {
    expect(blobResponse(hit, blobEtag(1600)).status).toBe(200);
  });
});

describe("etagMatches", () => {
  it("accepts exact, weak, list, and star; refuses empty and other revs", () => {
    expect(etagMatches("\"7\"", "\"7\"")).toBe(true);
    expect(etagMatches("W/\"7\"", "\"7\"")).toBe(true);
    expect(etagMatches("\"5\", \"7\"", "\"7\"")).toBe(true);
    expect(etagMatches("*", "\"7\"")).toBe(true);
    expect(etagMatches("\"8\"", "\"7\"")).toBe(false);
    expect(etagMatches("", "\"7\"")).toBe(false);
    expect(etagMatches(null, "\"7\"")).toBe(false);
    expect(etagMatches(undefined, "\"7\"")).toBe(false);
  });
});

describe("conditionalHeaders", () => {
  it("forwards If-None-Match and nothing else", () => {
    const withTag = new Request("https://x/api/chat/avatar?slug=kit", { headers: { "If-None-Match": "\"9\"", Cookie: "s=1" } });
    expect(conditionalHeaders(withTag)).toEqual({ "If-None-Match": "\"9\"" });
    expect(conditionalHeaders(new Request("https://x/api/chat/avatar?slug=kit"))).toEqual({});
  });
});

describe("avatarRequestPath", () => {
  it("keeps a clean query when secret and bearer are omitted", () => {
    expect(avatarRequestPath({ slug: "kit" })).toBe("/api/chat/avatar?slug=kit");
    expect(avatarRequestPath({ slug: "kit", rev: 0 })).toBe("/api/chat/avatar?slug=kit");
  });

  it("appends secret and bearer only when those args are provided", () => {
    expect(avatarRequestPath({ slug: "kit", rev: 9, secret: "s", bearer: "b" })).toBe(
      "/api/chat/avatar?slug=kit&v=9&secret=s&bearer=b",
    );
  });
});

describe("mailboxToAvatarUrl", () => {
  it("turns the crane wss mailbox into an https face POST", () => {
    expect(mailboxToAvatarUrl("wss://gantry-pendant.example.workers.dev/ws/kit")).toBe(
      "https://gantry-pendant.example.workers.dev/api/chat/avatar?slug=kit",
    );
    expect(mailboxToAvatarUrl("ws://127.0.0.1:3000/ws/kit")).toBe(
      "http://127.0.0.1:3000/api/chat/avatar?slug=kit",
    );
    expect(mailboxToAvatarUrl("not a url")).toBeNull();
    expect(mailboxToAvatarUrl("wss://x.example/ws/1bad")).toBeNull();
    expect(mailboxToAvatarUrl("ftp://x.example/ws/kit")).toBeNull();
    expect(mailboxToAvatarUrl("https://x.example/nope")).toBeNull();
  });
});

describe("readAvatarUpload", () => {
  it("reads multipart file or raw jpeg bytes", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1]);
    const raw = await readAvatarUpload(new Request("https://x/api/chat/avatar", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: jpeg,
    }));
    expect(raw.ok && raw.bytes.byteLength).toBe(4);

    const form = new FormData();
    form.append("file", new Blob([jpeg], { type: "image/jpeg" }), "avatar.jpg");
    const multi = await readAvatarUpload(new Request("https://x/api/chat/avatar", { method: "POST", body: form }));
    expect(multi.ok && multi.bytes[0]).toBe(0xff);

    const empty = await readAvatarUpload(new Request("https://x/api/chat/avatar", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=x" },
      body: "--x--",
    }));
    expect(empty.ok).toBe(false);
  });

  it("rejects an upload whose Content-Length is over the cap", async () => {
    const tooBig = await readAvatarUpload(new Request("https://x/api/chat/avatar", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg", "Content-Length": String(6 * 1024 * 1024) },
      body: new Uint8Array([0xff, 0xd8, 0xff, 1]),
    }));
    expect(tooBig).toEqual({ ok: false, detail: "image too large (max 5MB)" });
  });

  it("rejects a multipart file whose size is over the cap", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "image/jpeg" }), "avatar.jpg");
    const tooBig = await readAvatarUpload(new Request("https://x/api/chat/avatar", { method: "POST", body: form }));
    expect(tooBig).toEqual({ ok: false, detail: "image too large (max 5MB)" });
  });
});
