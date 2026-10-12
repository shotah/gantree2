import { describe, expect, it, vi } from "vitest";
import { runSlash, type SlashEnv } from "@/harness/agent/slash";
import { bindRoomAuth } from "@/harness/room/authbind";
import type { Plugin, PluginContext } from "@/harness/core/tools";
import type { Sql } from "@/harness/core/sql";
import { openOAuthCatch, sealOAuthCatch, sessionKey } from "@/lib/door/session";

const SECRET = "0123456789abcdef0123456789abcdef-more";
const REDIRECT = "https://gantree2.bldhosting.com/api/auth/catch";

function plugin(start: Plugin["authStart"], finish: Plugin["authFinish"], name = "google"): Plugin {
  return {
    name,
    ready: () => Promise.resolve(null),
    tools: () => [],
    authStart: start,
    authFinish: finish,
  };
}

function slashEnv(redirectUri: string, plugins: Plugin[], sql: object = {}): SlashEnv {
  return {
    plugins,
    pluginCtx: { sql: sql as Sql } as PluginContext,
    redirectUri,
    now: () => 1,
  } as unknown as SlashEnv;
}

describe("native /auth", () => {
  it("keeps the paste flow when the room has not bound a catch", async () => {
    const finish = vi.fn(async () => undefined);
    const start = vi.fn(async (_ctx: PluginContext, redirect: string, state: string) => ({
      url: `https://example/auth?redirect_uri=${redirect}&state=${state}`,
    }));
    const env = slashEnv("https://pages.example/oauth-catch/", [plugin(start, finish)]);
    const url = await runSlash(env, "s", "/auth google");
    expect(url).toContain("redirect_uri=https://pages.example/oauth-catch/");
    expect(url).toContain("state=auth-1");
    expect(url).toContain("guide:");
    const done = await runSlash(env, "s", "/auth google abc");
    expect(done).toBe("auth: google connected");
    expect(finish).toHaveBeenCalledOnce();
  });

  it("seals the worker catch and refuses a pasted code", async () => {
    const key = await sessionKey(SECRET);
    const sql = {};
    bindRoomAuth(sql, {
      redirectUri: () => REDIRECT,
      sealState: (name) => sealOAuthCatch(key, { slug: "kit", plugin: name }),
    });
    const finish = vi.fn(async () => undefined);
    const start = vi.fn(async (_ctx: PluginContext, redirect: string, state: string) => ({
      url: `https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=${redirect}&state=${state}`,
    }));
    const env = slashEnv("", [plugin(start, finish)], sql);
    const reply = await runSlash(env, "s", "/auth google");
    expect(reply).toContain(`redirect_uri=${REDIRECT}`);
    expect(reply).toContain("Open it, approve, and you'll land back here connected.");
    expect(reply).not.toContain("OAUTH_REDIRECT_URI");
    const state = start.mock.calls[0]?.[2];
    expect(typeof state).toBe("string");
    if (typeof state !== "string") {
      throw new Error("state");
    }
    expect(start.mock.calls[0]?.[1]).toBe(REDIRECT);
    expect(await openOAuthCatch(key, state)).toEqual({ slug: "kit", plugin: "google" });

    const paste = await runSlash(env, "s", "/auth google abc");
    expect(paste).toBe("auth: not needed. Open it, approve, and you'll land back here connected.");
    expect(finish).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledOnce();
  });

  it("does not ask for OAUTH_REDIRECT_URI once the room is bound", async () => {
    const sql = {};
    bindRoomAuth(sql, {
      redirectUri: () => "",
      sealState: () => Promise.resolve("unused"),
    });
    const env = slashEnv("", [plugin(async () => ({ url: "https://example" }), async () => undefined)], sql);
    expect(await runSlash(env, "s", "/auth google")).toBe("auth: no public origin");
  });
});
