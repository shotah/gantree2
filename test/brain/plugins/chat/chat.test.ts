import { encode as encodePng } from "fast-png";
import { encode as encodeJpeg } from "jpeg-js";
import { describe, expect, it } from "vitest";
import {
  blobURL,
  createWarner,
  errNeedBearer,
  errNeedMailbox,
  lookupAlias,
  mailboxToAPI,
  nextAvatarGet,
  nextAvatarUpdate,
  nextBackdropDelete,
  nextBackdropUpdate,
  nextThemeDelete,
  nextThemeList,
  resolveServerConfig,
} from "@/brain/plugins/chat/config";
import { decodeChatImage, readSource, chatPlugin } from "@/brain/plugins/chat/index";
import { fitSize, isJpeg, prepareJpeg, setJpegEncoder, shrinkToJpeg, type JpegEncoder, type Rgba } from "@/brain/plugins/chat/jpeg";
import { putOutputFile } from "@/brain/plugins/image/files";
import { cachedThemeIDs, forgetThemeCatalog, parseThemeIDs, rememberThemeCatalog, themeCatalogTTL } from "@/brain/plugins/chat/theme";
import { b64, bodyBytes, callTool, hrefOf, jsonResponse, pluginCtx, responseBytes, textOf } from "../helpers";
import { makeLogger, memorySink } from "@/brain/core/log";
import { fixedClock } from "@/brain/core/clock";
import type { ServerConfig } from "@/brain/plugins/chat/config";

const encodeJpegTyped = encodeJpeg as unknown as (img: { data: Uint8Array; width: number; height: number }, quality: number) => { data: Uint8Array };

const catalogIds = ["boom", "paper", "ink", "marquee", "lemonade", "neon", "fizz", "rain", "mist", "fuse", "grit", "siren", "flare", "static", "flicker"];

function tinyPng(w: number, h: number): Uint8Array {
  const data = new Uint8Array(w * h * 4);
  data[0] = 200;
  data[3] = 255;
  return encodePng({ width: w, height: h, data });
}

function tinyJpeg(): Uint8Array {
  const data = new Uint8Array(32 * 32 * 4);
  data[3] = 255;
  return new Uint8Array(encodeJpegTyped({ data, width: 32, height: 32 }, 90).data);
}

function room(slug: string): ServerConfig {
  return {
    mailboxURL: "https://example.workers.dev",
    apiPrefix: "/api/chat",
    bearer: "secret",
    slug,
    imageRoots: [],
  };
}

const chatEnv = {
  PENDANT_MAILBOX_URL: "wss://example.workers.dev/ws/kit",
  PENDANT_BEARER: "secret-token",
};

describe("chat config", () => {
  it("turns a mailbox socket into an https origin and slug", () => {
    expect(mailboxToAPI("wss://gantry-pendant.example.workers.dev/ws/kit")).toEqual({
      base: "https://gantry-pendant.example.workers.dev",
      slug: "kit",
    });
    expect(mailboxToAPI("ws://127.0.0.1:3000/ws/kit")).toEqual({ base: "http://127.0.0.1:3000", slug: "kit" });
    expect(() => mailboxToAPI("not a url")).toThrow();
    expect(() => mailboxToAPI("wss://x.example/ws/1bad")).toThrow();
    expect(() => mailboxToAPI("ftp://x.example/ws/kit")).toThrow();
    expect(() => mailboxToAPI("https://x.example/nope")).toThrow();
  });

  it("loads the chat pair, the alias pair, and the prefix hatch", () => {
    const sink = memorySink();
    const clock = fixedClock(0);
    const log = makeLogger(sink, () => clock.now());
    const cfg = resolveServerConfig({
      CHAT_MAILBOX_URL: "wss://example.workers.dev/ws/kit",
      CHAT_BEARER: "secret",
      IMAGE_OUTPUT_DIR: "/tmp/out",
      PENDANT_MAILBOX_URL: "wss://old.example/ws/nope",
      PENDANT_BEARER: "old-secret",
    }, createWarner(log));
    expect(cfg).toMatchObject({ slug: "kit", bearer: "secret", mailboxURL: "https://example.workers.dev", apiPrefix: "/api/chat" });
    expect(cfg.imageRoots).toEqual(["/tmp/out"]);
    expect(blobURL(cfg, "avatar")).toBe("https://example.workers.dev/api/chat/avatar?slug=kit");
    expect(blobURL({ ...cfg, apiPrefix: "" }, "theme")).toBe("https://example.workers.dev/api/chat/theme?slug=kit");
    expect(sink.records).toHaveLength(0);
    expect(() => resolveServerConfig({}, null)).toThrow(errNeedMailbox());
    expect(() => resolveServerConfig({ CHAT_MAILBOX_URL: "wss://x.example/ws/kit" }, null)).toThrow(errNeedBearer());
  });

  it("warns once for a deprecated alias and stays quiet when CHAT_* is set", () => {
    const sink = memorySink();
    const warn = createWarner(makeLogger(sink, () => 0));
    const cfg = resolveServerConfig({
      PENDANT_MAILBOX_URL: "wss://example.workers.dev/ws/kit",
      PENDANT_BEARER: "secret",
      CHAT_API_PREFIX: "/api/",
    }, warn);
    expect(cfg.bearer).toBe("secret");
    expect(blobURL(cfg, "avatar")).toBe("https://example.workers.dev/api/avatar?slug=kit");
    const text = sink.records.map((r) => `${r.message} env=${String(r.fields?.env)}`).join("\n");
    expect(text).toContain("deprecated, use CHAT_MAILBOX_URL");
    expect(text).toContain("env=PENDANT_MAILBOX_URL");
    expect(text).toContain("deprecated, use CHAT_BEARER");
    expect(sink.records.filter((r) => r.message.includes("deprecated, use "))).toHaveLength(2);
    const before = sink.records.length;
    resolveServerConfig({
      PENDANT_MAILBOX_URL: "wss://example.workers.dev/ws/kit",
      PENDANT_BEARER: "secret",
      CHAT_API_PREFIX: "/api/",
    }, warn);
    expect(sink.records).toHaveLength(before);
    const quiet = memorySink();
    const again = resolveServerConfig({
      CHAT_MAILBOX_URL: "wss://chat.example/ws/kit",
      CHAT_BEARER: "chat-secret",
      PENDANT_MAILBOX_URL: "wss://old.example/ws/nope",
      PENDANT_BEARER: "old",
      CHAT_API_PREFIX: "api/chat/",
    }, createWarner(makeLogger(quiet, () => 0)));
    expect(again).toMatchObject({ mailboxURL: "https://chat.example", bearer: "chat-secret", apiPrefix: "/api/chat" });
    expect(quiet.records).toHaveLength(0);
    expect(lookupAlias({ PENDANT_MAILBOX_URL: "wss://alias.example/ws/kit" }, "CHAT_MAILBOX_URL", "PENDANT_MAILBOX_URL", null))
      .toBe("wss://alias.example/ws/kit");
  });
});

describe("chat jpeg", () => {
  it("fits the long edge and never upscales", () => {
    expect(fitSize(4000, 3000, 1600)).toEqual([1600, 1200]);
    expect(fitSize(4000, 3000, 1200)).toEqual([1200, 900]);
    expect(fitSize(64, 64, 1280)).toEqual([64, 64]);
  });

  it("walks qualities then the edge ladder", () => {
    const tries: { w: number; q: number }[] = [];
    const encoder: JpegEncoder = (img, quality) => {
      tries.push({ w: img.width, q: quality });
      const size = Math.trunc(img.width * img.height * (quality / 100) * 0.3);
      return new Uint8Array(size);
    };
    setJpegEncoder(encoder);
    try {
      const src: Rgba = { data: new Uint8Array(4000 * 3000 * 4), width: 4000, height: 3000 };
      const got = shrinkToJpeg(src, 1600, 300_000);
      expect(got.data.byteLength).toBeLessThanOrEqual(300_000);
      expect(got.edge).toBe(1200);
      expect(tries[0]).toEqual({ w: 1600, q: 90 });
      const widths = [...new Set(tries.map((t) => t.w))];
      expect(widths).toEqual([1600, 1200]);
      expect(tries.filter((t) => t.w === 1600).map((t) => t.q)).toEqual([90, 80, 70, 60]);
    } finally {
      setJpegEncoder(null);
    }
  });

  it("gives up once the edge drops under the floor", () => {
    let smallest = Number.MAX_SAFE_INTEGER;
    setJpegEncoder((img) => {
      if (img.width < smallest) smallest = img.width;
      return new Uint8Array(500_000);
    });
    try {
      const src: Rgba = { data: new Uint8Array(4000 * 3000 * 4), width: 4000, height: 3000 };
      expect(() => shrinkToJpeg(src, 1600, 1_000)).toThrow("image too large");
      expect(smallest).toBeGreaterThanOrEqual(320);
      expect(smallest).toBeLessThan(480);
    } finally {
      setJpegEncoder(null);
    }
  });

  it("passes a small jpeg through and encodes a png", () => {
    const raw = tinyJpeg();
    const passed = prepareJpeg(raw, 1280, 5 * 1024 * 1024);
    expect(passed.data).toEqual(raw);
    expect(passed.edge).toBeGreaterThanOrEqual(1);
    const png = prepareJpeg(tinyPng(32, 32), 1280, 5 * 1024 * 1024);
    expect(isJpeg(png.data)).toBe(true);
    expect(() => prepareJpeg(new TextEncoder().encode("not an image"), 1280, 1000)).toThrow();
  });
});

describe("chat theme cache", () => {
  it("reads catalog ids and refuses an empty or junk body", () => {
    const ids = parseThemeIDs(`{"theme":"boom","themes":[{"id":"Paper"},{"id":"siren"},{"id":" ink "}]}`);
    expect(ids.has("paper")).toBe(true);
    expect(ids.has("siren")).toBe(true);
    expect(ids.has("ink")).toBe(true);
    expect(ids.has("boom")).toBe(false);
    expect(() => parseThemeIDs(`{"theme":null,"themes":[]}`)).toThrow("theme catalog is empty");
    expect(() => parseThemeIDs("{")).toThrow("bad theme catalog");
  });

  it("keeps teach-in text free of catalog card ids", () => {
    const re = new RegExp(`\\b(?:${catalogIds.join("|")})\\b`, "i");
    for (const blob of [nextAvatarUpdate, nextAvatarGet, nextBackdropUpdate, nextBackdropDelete, nextThemeList, nextThemeDelete]) {
      expect(blob).not.toMatch(re);
    }
  });

  it("is per room, expires, and can be forgotten", () => {
    const ctx = pluginCtx();
    rememberThemeCatalog(ctx.sql, ctx.clock, room("kit"), new Set(["siren"]));
    rememberThemeCatalog(ctx.sql, ctx.clock, room("ada"), new Set(["paper"]));
    const kit = cachedThemeIDs(ctx.sql, ctx.clock, room("kit"));
    expect(kit?.has("siren")).toBe(true);
    expect(kit?.has("paper")).toBe(false);
    const ada = cachedThemeIDs(ctx.sql, ctx.clock, room("ada"));
    expect(ada?.has("paper")).toBe(true);
    expect(ada?.has("siren")).toBe(false);
    ctx.clock.tick(themeCatalogTTL + 1000);
    expect(cachedThemeIDs(ctx.sql, ctx.clock, room("kit"))).toBeUndefined();
    const fresh = pluginCtx();
    rememberThemeCatalog(fresh.sql, fresh.clock, room("kit"), new Set(["siren"]));
    forgetThemeCatalog(fresh.sql, room("kit"));
    expect(cachedThemeIDs(fresh.sql, fresh.clock, room("kit"))).toBeUndefined();
  });
});

describe("chat source", () => {
  it("reads a file inside the root and refuses one outside", () => {
    const root = "/tmp/gantree-chat-root";
    const ctx = pluginCtx({ env: { IMAGE_OUTPUT_DIR: root } });
    const path = `${root}/shot.png`;
    putOutputFile(ctx.sql, path, new TextEncoder().encode("png-bytes"));
    expect(new TextDecoder().decode(readSource(ctx, path, ""))).toBe("png-bytes");
    expect(() => readSource(ctx, "/etc/hostname", "")).toThrow();
    expect(() => readSource(pluginCtx(), "/tmp/x.png", "")).toThrow("IMAGE_OUTPUT_DIR");
    expect(() => readSource(ctx, "a", "b")).toThrow("exactly one");
    const raw = b64("hello");
    expect(new TextDecoder().decode(decodeChatImage(raw))).toBe("hello");
    expect(new TextDecoder().decode(decodeChatImage(`data:image/png;base64,${raw}`))).toBe("hello");
    expect(() => decodeChatImage("not-base64!!!")).toThrow("base64");
    expect(new TextDecoder().decode(readSource(pluginCtx(), "", b64("from-b64")))).toBe("from-b64");
  });
});

describe("chat plugin", () => {
  it("publishes seven tools with no required key", async () => {
    expect(chatPlugin.name).toBe("chat");
    expect(await chatPlugin.ready(pluginCtx())).toBeNull();
    const tools = chatPlugin.tools(pluginCtx());
    expect(tools.map((t) => t.name)).toEqual([
      "avatar_update",
      "avatar_get",
      "backdrop_update",
      "backdrop_delete",
      "theme_list",
      "theme_update",
      "theme_delete",
    ]);
    const re = /\b(?:boom|paper|ink|marquee|lemonade|neon|fizz|rain|mist|fuse|grit|siren|flare|static|flicker)\b/i;
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z]+_[a-z]+/);
      expect(tool.name.startsWith("chat") || tool.name.startsWith("pendant")).toBe(false);
      expect(JSON.stringify({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })).not.toMatch(re);
    }
    for (const tool of tools) {
      if (tool.name === "theme_list") {
        expect(tool.single).toBeUndefined();
      } else {
        expect(tool.single?.length).toBeGreaterThan(0);
      }
    }
  });

  it("posts a jpeg face from a path and refuses a path outside the root", async () => {
    const root = "/tmp/gantree-chat-avatar";
    const path = `${root}/face.png`;
    let auth = "";
    let contentType = "";
    let url = "";
    let body: Uint8Array<ArrayBufferLike> = new Uint8Array();
    const ctx = pluginCtx({
      env: { ...chatEnv, IMAGE_OUTPUT_DIR: root },
      fetch: async (input, init) => {
        url = hrefOf(input);
        const headers = new Headers(init?.headers);
        auth = headers.get("authorization") ?? "";
        contentType = headers.get("content-type") ?? "";
        body = bodyBytes(init?.body);
        return jsonResponse({ ok: true, rev: 1725, detail: "saved face" });
      },
    });
    putOutputFile(ctx.sql, path, tinyPng(40, 40));
    const result = await callTool(chatPlugin, ctx, "avatar_update", { source_path: path });
    expect(result.isError).toBeUndefined();
    expect(auth).toBe("Bearer secret-token");
    expect(contentType).toBe("image/jpeg");
    expect(url).toContain("/api/chat/avatar?slug=kit");
    expect(isJpeg(body)).toBe(true);
    expect(textOf(result)).not.toContain("secret-token");
    expect(JSON.parse(textOf(result))).toMatchObject({ rev: 1725, mime: "image/jpeg" });

    const refused = await callTool(chatPlugin, ctx, "avatar_update", { source_path: "/etc/hostname" });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("source_path");
  });

  it("lists themes once and posts a catalog id", async () => {
    let gets = 0;
    let posts = 0;
    const catalog = `{"theme":"boom","themes":[{"id":"siren","label":"Siren","feel":"angry","scheme":"dark","mood":"angry, dark — siren at night: black red, scarlet","canvas":"#160608","accent":"#ff2e3f"}]}`;
    const ctx = pluginCtx({
      env: chatEnv,
      fetch: async (_input, init) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET") {
          gets += 1;
          return new Response(catalog, { status: 200, headers: { "content-type": "application/json" } });
        }
        posts += 1;
        const raw = init?.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : "";
        expect(raw).toContain(`"siren"`);
        return jsonResponse({ ok: true, theme: "siren", detail: "theme siren" });
      },
    });
    const listed = await callTool(chatPlugin, ctx, "theme_list", {});
    expect(listed.isError).toBeUndefined();
    expect(textOf(listed)).toContain("siren at night");
    expect(textOf(listed)).toContain(`"feel":"angry"`);
    const updated = await callTool(chatPlugin, ctx, "theme_update", { theme: "siren" });
    expect(textOf(updated)).toContain(`"theme":"siren"`);
    expect(gets).toBe(1);
    expect(posts).toBe(1);
  });

  it("refuses a theme that is not in the catalog and does not POST", async () => {
    let posts = 0;
    const ctx = pluginCtx({
      env: chatEnv,
      fetch: async (_input, init) => {
        if ((init?.method ?? "GET").toUpperCase() === "POST") posts += 1;
        return jsonResponse({ theme: "boom", themes: [{ id: "siren" }] });
      },
    });
    for (const theme of ["#ff00ff", undefined, "noir"] as const) {
      const args = theme === undefined ? {} : { theme };
      const result = await callTool(chatPlugin, ctx, "theme_update", args);
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("theme_list");
    }
    expect(posts).toBe(0);
  });

  it("accepts paper and drops the cache when the worker rejects", async () => {
    const paper = pluginCtx({
      env: chatEnv,
      fetch: async (_input, init) => {
        if ((init?.method ?? "GET").toUpperCase() === "GET") {
          return jsonResponse({ theme: null, themes: [{ id: "paper" }] });
        }
        const raw = init?.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : "";
        expect(raw).toContain(`"paper"`);
        return jsonResponse({ ok: true, theme: "paper" });
      },
    });
    const accepted = await callTool(chatPlugin, paper, "theme_update", { theme: "paper" });
    expect(textOf(accepted)).toContain(`"theme":"paper"`);

    let gets = 0;
    let posts = 0;
    const rejected = pluginCtx({
      env: chatEnv,
      fetch: async (_input, init) => {
        if ((init?.method ?? "GET").toUpperCase() === "GET") {
          gets += 1;
          return jsonResponse({ theme: null, themes: [{ id: "siren" }] });
        }
        posts += 1;
        return jsonResponse({ error: "bad theme" }, 400);
      },
    });
    const first = await callTool(chatPlugin, rejected, "theme_update", { theme: "siren" });
    const second = await callTool(chatPlugin, rejected, "theme_update", { theme: "siren" });
    expect(textOf(first)).toBe("bad theme");
    expect(textOf(second)).toBe("bad theme");
    expect(gets).toBe(2);
    expect(posts).toBe(2);
  });

  it("clears a theme and a backdrop", async () => {
    const theme = pluginCtx({
      env: chatEnv,
      fetch: async () => new Response(`{"ok":true,"theme":null,"detail":"cleared theme"}`, { status: 200 }),
    });
    const cleared = await callTool(chatPlugin, theme, "theme_delete", {});
    expect(textOf(cleared)).toContain("cleared");
    const backdrop = pluginCtx({
      env: chatEnv,
      fetch: async (input, init) => {
        const url = hrefOf(input);
        expect((init?.method ?? "").toUpperCase()).toBe("DELETE");
        expect(url).toContain("/api/chat/backdrop");
        return jsonResponse({ ok: true, rev: 0, detail: "cleared backdrop" });
      },
    });
    const gone = JSON.parse(textOf(await callTool(chatPlugin, backdrop, "backdrop_delete", {}))) as { rev: number; edge: number; bytes: number };
    expect(gone).toMatchObject({ rev: 0, edge: 0, bytes: 0 });
  });

  it("writes the current face and returns the worker error verbatim", async () => {
    const dir = "/tmp/gantree-chat-get";
    const jpeg = tinyJpeg();
    const ctx = pluginCtx({
      env: { ...chatEnv, IMAGE_OUTPUT_DIR: dir },
      fetch: async () => responseBytes(jpeg, 200, { "x-pendant-rev": "9", "content-type": "image/jpeg" }),
    });
    const result = await callTool(chatPlugin, ctx, "avatar_get", {});
    expect(result.isError).toBeUndefined();
    const sum = JSON.parse(textOf(result)) as { rev: number; path: string; edge: number };
    expect(sum.rev).toBe(9);

    const chatRev = pluginCtx({
      env: { ...chatEnv, IMAGE_OUTPUT_DIR: dir },
      fetch: async () => responseBytes(jpeg, 200, { "x-chat-rev": "11", "content-type": "image/jpeg" }),
    });
    const fromChatRev = await callTool(chatPlugin, chatRev, "avatar_get", {});
    const chatRevSum = JSON.parse(textOf(fromChatRev)) as { rev: number };
    expect(chatRevSum.rev).toBe(11);
    expect(sum.edge).toBe(1280);
    expect(sum.path.startsWith(`${dir}/`)).toBe(true);
    expect(result.content[1]).toMatchObject({ type: "image", mimeType: "image/jpeg" });

    const root = "/tmp/gantree-chat-rate";
    const path = `${root}/x.png`;
    const rate = pluginCtx({
      env: { ...chatEnv, IMAGE_OUTPUT_DIR: root },
      fetch: async () => jsonResponse({ error: "rate" }, 429),
    });
    putOutputFile(rate.sql, path, tinyPng(16, 16));
    const err = await callTool(chatPlugin, rate, "backdrop_update", { source_path: path });
    expect(err.isError).toBe(true);
    expect(textOf(err)).toBe("rate");
  });

  it("accepts a base64 backdrop and teaches in when the mailbox is missing", async () => {
    const ctx = pluginCtx({
      env: chatEnv,
      fetch: async () => jsonResponse({ ok: true, rev: 1 }),
    });
    const encoded = b64(tinyPng(24, 24));
    const result = await callTool(chatPlugin, ctx, "backdrop_update", { source_image: encoded });
    expect(result.isError).toBeUndefined();
    const missing = await callTool(chatPlugin, pluginCtx(), "theme_list", {});
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain("CHAT_MAILBOX_URL");
  });
});
