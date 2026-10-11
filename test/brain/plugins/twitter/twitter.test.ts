import { describe, expect, it } from "vitest";
import { APIError, clientFromEnv, defaultBaseURL, listTweets, lookupUser, parseAPIError, type XClient } from "@/brain/plugins/twitter/client";
import { listPosts, normalizeHandle, teachIn, twitterPlugin } from "@/brain/plugins/twitter/index";
import { WatchStore } from "@/brain/watch";
import { callTool, hrefOf, jsonResponse, pluginCtx, textOf, textResponse } from "../helpers";

function client(fetchImpl: typeof fetch, extra: Partial<XClient> = {}): XClient {
  return {
    baseURL: "https://x.test",
    token: "test-token",
    maxBytes: 2 << 20,
    fetch: fetchImpl,
    ...extra,
  };
}

function xapi(spec: { username: string; userID: string; tweets?: { id: string; text: string }[] }): typeof fetch {
  return async (input, init) => {
    const href = hrefOf(input);
    const headers = new Headers(init?.headers);
    if (headers.get("authorization") !== "Bearer test-token") {
      return textResponse(`{"title":"Unauthorized","status":401}`, 401);
    }
    const url = new URL(href);
    if (url.pathname.startsWith("/2/users/by/username/")) {
      const name = decodeURIComponent(url.pathname.slice("/2/users/by/username/".length));
      if (name.toLowerCase() !== spec.username.toLowerCase()) {
        return textResponse(`{"title":"Not Found Error"}`, 404);
      }
      return jsonResponse({ data: { id: spec.userID, username: spec.username } });
    }
    if (url.pathname.endsWith("/tweets")) {
      return jsonResponse({ data: spec.tweets ?? [] });
    }
    return textResponse("nope", 404);
  };
}

describe("twitter posts", () => {
  it("strips a leading @ and rejects a blank handle", () => {
    expect(normalizeHandle("  @Foo ")).toBe("Foo");
    expect(() => normalizeHandle(" @ ")).toThrow("handle is required");
    expect(() => normalizeHandle("")).toThrow("handle is required");
  });

  it("lists posts and drops an empty id", async () => {
    const got = await listPosts(client(xapi({
      username: "Foo",
      userID: "42",
      tweets: [
        { id: "123", text: "hello world" },
        { id: "124", text: "second" },
        { id: "", text: "dropped" },
      ],
    })), "@Foo", 10);
    expect(got.items).toHaveLength(2);
    expect(got.items[0]).toMatchObject({
      id: "123",
      title: "hello world",
      url: "https://x.com/Foo/status/123",
      summary: "hello world",
    });
  });

  it("honors a small limit and clamps a huge one", async () => {
    const many = Array.from({ length: 55 }, (_, i) => ({ id: String(i + 1), text: "t" }));
    const small = await listPosts(client(xapi({ username: "foo", userID: "1", tweets: many })), "foo", 2);
    expect(small.items).toHaveLength(2);
    const capped = await listPosts(client(xapi({ username: "foo", userID: "1", tweets: many })), "foo", 999);
    expect(capped.items).toHaveLength(50);
  });

  it("returns an empty item list, not a missing one", async () => {
    const got = await listPosts(client(xapi({ username: "foo", userID: "1" })), "foo", 0);
    expect(got.items).toEqual([]);
  });

  it("teaches in on 401, 404, and 429", async () => {
    const denied = client(async () => textResponse(`{"title":"Unauthorized","status":401,"detail":"Unauthorized"}`, 401));
    await expect(listPosts(denied, "foo", 5)).rejects.toBeInstanceOf(APIError);
    try {
      await listPosts(denied, "foo", 5);
    } catch (err) {
      const msg = teachIn(err, "foo");
      expect(msg).toContain("401");
      expect(msg).toContain("Next: set a valid app-only Bearer");
    }

    const missing = client(async (input) => {
      const href = hrefOf(input);
      if (href.includes("/users/by/username/")) {
        return textResponse(`{"errors":[{"detail":"Could not find user with username: [missing].","title":"Not Found Error"}]}`, 404);
      }
      return jsonResponse({ data: [] });
    });
    try {
      await listPosts(missing, "missing", 5);
      expect.fail("expected 404");
    } catch (err) {
      const msg = teachIn(err, "missing");
      expect(msg).toContain(`"missing"`);
      expect(msg).toContain("Next: posts_list");
    }

    expect(teachIn(new APIError(429, "Too Many Requests", ""), "foo")).toContain("30–60m");
    expect(teachIn(new Error("boom"), "foo")).toBe("boom");
  });

  it("surfaces a tweet-list 429 through the teach-in", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const href = hrefOf(input);
      if (href.includes("/users/by/username/")) return jsonResponse({ data: { id: "1", username: "foo" } });
      return textResponse(`{"title":"Too Many Requests","status":429}`, 429);
    };
    await expect(listPosts(client(fetchImpl), "foo", 5)).rejects.toMatchObject({ status: 429 });
  });

  it("rejects a nil client", async () => {
    await expect(listPosts(null, "foo", 5)).rejects.toThrow("X_BEARER_TOKEN");
  });
});

describe("twitter client", () => {
  it("requires a non-blank bearer", () => {
    expect(() => clientFromEnv({ X_BEARER_TOKEN: "  " }, fetch)).toThrow("X_BEARER_TOKEN");
    const c = clientFromEnv({ X_BEARER_TOKEN: "secret" }, fetch);
    expect(c.token).toBe("secret");
    expect(c.baseURL).toBe(defaultBaseURL);
  });

  it("rejects invalid user and tweet JSON, and an empty user", async () => {
    await expect(lookupUser(client(async () => textResponse("not-json")), "foo")).rejects.toThrow("user lookup");
    await expect(lookupUser(client(async () => textResponse("{}")), "foo")).rejects.toMatchObject({ status: 404 });
    await expect(listTweets(client(async () => textResponse("{")), "1", 5)).rejects.toThrow("tweet list");
  });

  it("caps the body and sends the bearer", async () => {
    await expect(lookupUser(client(async () => textResponse("abcdef"), { maxBytes: 3 }), "foo")).rejects.toThrow("larger than");
    let auth = "";
    const user = await lookupUser(client(async (_input, init) => {
      auth = new Headers(init?.headers).get("authorization") ?? "";
      return textResponse(`{"data":{"id":"1","username":"foo"}}`);
    }, { token: "tok" }), "foo");
    expect(auth).toBe("Bearer tok");
    expect(user.id).toBe("1");
  });

  it("reads the errors[].message field and falls back to HTTP status", () => {
    const err = parseAPIError(401, `{"errors":[{"message":"Invalid or expired token"}]}`);
    expect(err.detail).toBe("Invalid or expired token");
    expect(err.message).toContain("Invalid or expired token");
    expect(new APIError(500, "", "").message).toBe("X API: HTTP 500");
    expect(new APIError(400, "Bad Request", "").message).toContain("Bad Request");
  });

  it("turns a tweet HTTP error into an APIError", async () => {
    await expect(listTweets(client(async () => textResponse(`{"title":"Bad Request","detail":"max_results"}`, 400)), "1", 5))
      .rejects.toMatchObject({ status: 400 });
  });

  it("rejects a bad base URL and a failed fetch", async () => {
    await expect(lookupUser(client(fetch, { baseURL: "://bad" }), "foo")).rejects.toThrow("base url");
    await expect(listTweets(client(async () => {
      throw new Error("closed");
    }), "1", 5)).rejects.toThrow("closed");
  });

  it("uses the default host when base URL and max bytes are unset", async () => {
    let got = "";
    const user = await lookupUser({
      baseURL: "",
      token: "tok",
      maxBytes: 0,
      fetch: async (input) => {
        got = hrefOf(input);
        return textResponse(`{"data":{"id":"1","username":""}}`);
      },
    }, "foo");
    expect(user).toEqual({ id: "1", username: "foo" });
    expect(got.startsWith(defaultBaseURL)).toBe(true);
  });

  it("surfaces a body read failure", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("unexpected EOF"));
      },
    });
    await expect(lookupUser(client(async () => new Response(body)), "foo")).rejects.toThrow("unexpected EOF");
  });
});

describe("twitter plugin", () => {
  it("skips without a bearer and publishes posts_list", async () => {
    expect(twitterPlugin.name).toBe("twitter");
    expect(await twitterPlugin.ready(pluginCtx())).toBe("no_key");
    expect(await twitterPlugin.ready(pluginCtx({ env: { X_BEARER_TOKEN: "  " } }))).toBe("no_key");
    expect(await twitterPlugin.ready(pluginCtx({ env: { X_BEARER_TOKEN: "tok" } }))).toBeNull();
    const tool = twitterPlugin.tools(pluginCtx())[0];
    expect(tool?.name).toBe("posts_list");
    expect(tool?.description).toContain("Official X API only");
    expect(tool?.description).toContain("6h");
    expect(tool?.description).toContain("X_MONTHLY_READS");
    expect(tool?.inputSchema).toMatchObject({
      type: "object",
      required: ["handle"],
      properties: {
        handle: { type: "string" },
        limit: { type: "number" },
      },
    });
  });

  it("teaches in when handle or token is missing", async () => {
    const missing = await callTool(twitterPlugin, pluginCtx({ env: { X_BEARER_TOKEN: "tok" } }), "posts_list", {});
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain(`Next: posts_list(handle="foo")`);
    const blank = await callTool(twitterPlugin, pluginCtx({ env: { X_BEARER_TOKEN: "tok" } }), "posts_list", { handle: " @ " });
    expect(textOf(blank)).toContain("handle is required");
    const token = await callTool(twitterPlugin, pluginCtx(), "posts_list", { handle: "foo" });
    expect(textOf(token)).toContain("X_BEARER_TOKEN");
    expect(textOf(token)).toContain("Next:");
  });

  it("returns watch JSON and a 401 teach-in from the tool", async () => {
    const ok = pluginCtx({
      env: { X_BEARER_TOKEN: "test-token" },
      fetch: xapi({ username: "foo", userID: "9", tweets: [{ id: "555", text: "hi" }] }),
    });
    const result = await callTool(twitterPlugin, ok, "posts_list", { handle: "foo", limit: 5 });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textOf(result))).toMatchObject([{ handle: "foo", items: [{ id: "555" }] }]);

    const denied = pluginCtx({
      env: { X_BEARER_TOKEN: "nope" },
      fetch: async () => textResponse(`{"title":"Unauthorized","status":401}`, 401),
    });
    const err = await callTool(twitterPlugin, denied, "posts_list", { handle: "foo" });
    const errRows = JSON.parse(textOf(err)) as { error?: string }[];
    expect(err.isError).toBeUndefined();
    expect(errRows[0]?.error).toContain("401");

    const both = pluginCtx({
      env: { X_BEARER_TOKEN: "test-token" },
      fetch: async (input, init) => {
        const href = hrefOf(input);
        const headers = new Headers(init?.headers);
        if (headers.get("authorization") !== "Bearer test-token") {
          return textResponse(`{"title":"Unauthorized","status":401}`, 401);
        }
        const url = new URL(href);
        if (url.pathname.startsWith("/2/users/by/username/")) {
          const name = decodeURIComponent(url.pathname.slice("/2/users/by/username/".length));
          if (name.toLowerCase() === "gone") return textResponse(`{"title":"Not Found Error"}`, 404);
          return jsonResponse({ data: { id: "9", username: name } });
        }
        return jsonResponse({ data: [{ id: "555", text: "hi" }] });
      },
    });
    const batch = JSON.parse(textOf(await callTool(twitterPlugin, both, "posts_list", { handles: ["foo", "gone"] }))) as { handle: string; items?: { id: string }[]; error?: string }[];
    expect(batch[0]).toMatchObject({ handle: "foo", items: [{ id: "555" }] });
    expect(batch[1]?.handle).toBe("gone");
    expect(batch[1]?.error).toContain("not found");
  });

  it("stops at the monthly read budget, skips the poller, and resumes next month", async () => {
    const ctx = pluginCtx({
      env: { X_BEARER_TOKEN: "test-token", X_MONTHLY_READS: "1" },
      fetch: xapi({ username: "foo", userID: "9", tweets: [{ id: "555", text: "hi" }] }),
    });
    const first = JSON.parse(textOf(await callTool(twitterPlugin, ctx, "posts_list", { handle: "foo" }))) as { items?: { id: string }[] }[];
    expect(first[0]?.items?.[0]?.id).toBe("555");

    const blocked = await callTool(twitterPlugin, ctx, "posts_list", { handles: ["foo", "foo"] });
    expect(blocked.isError).toBeUndefined();
    const rows = JSON.parse(textOf(blocked)) as { handle?: string; error?: string; items?: unknown[] }[];
    expect(rows[0]?.error).toContain("budget (1)");
    expect(rows[0]?.error).toContain("resets 2026-02-01T00:00:00Z");
    expect(blocked.retryAfter).toBe(Date.parse("2026-02-01T00:00:00.000Z"));

    const store = new WatchStore(ctx.sql, ctx.clock, 10, ctx.log);
    store.setTwitterReadLimit(1);
    const watch = store.add("twitter__posts_list", { handle: "foo" }, "foo", 6 * 60 * 60, { sessionId: "s" });
    store.forceDueForTest(watch.id);
    let calls = 0;
    await store.pollDue(ctx.clock.now(), async () => {
      calls += 1;
      return { content: [{ type: "text", text: "{\"items\":[]}" }] };
    }, async () => {
      throw new Error("over budget must not wake");
    });
    expect(calls).toBe(0);
    expect(store.get(watch.id).consecutiveErrors).toBe(0);
    expect(store.get(watch.id).lastError).toContain("resets 2026-02-01T00:00:00Z");

    ctx.clock.set(Date.parse("2026-02-01T00:00:00Z"));
    const again = JSON.parse(textOf(await callTool(twitterPlugin, ctx, "posts_list", { handle: "foo" }))) as { items?: { id: string }[] }[];
    expect(again[0]?.items?.[0]?.id).toBe("555");
  });
});
