import { describe, expect, it } from "vitest";
import { memorySink } from "@/brain/core/log";
import { errorResult, textResult, type JsonSchema, type Plugin, type Tool } from "@/brain/core/tools";
import { EnableStore } from "@/brain/tools/enable";
import { Registry, type RegistryOptions } from "@/brain/tools/registry";
import { TRUNCATION_MARKER } from "@/brain/tools/truncate";
import { callCtx, echoTool, fakePlugin, memSql, testClock, testContext, textOf } from "./fixture";

async function start(plugins: readonly Plugin[], options?: RegistryOptions) {
  const sql = memSql();
  const clock = testClock();
  const sink = memorySink();
  const ctx = testContext(sql, clock, sink);
  const registry = new Registry(plugins, ctx, { dynamicTools: false, resultMaxChars: 0, ...options });
  const status = await registry.publish();
  return { registry, status, sink, clock, sql, ctx };
}

function names(defs: { name: string }[]): string[] {
  return defs.map((def) => def.name);
}

describe("publish", () => {
  it("returns a status frame and keeps a failed plugin from taking the catalog down", async () => {
    let listed = false;
    const broken = fakePlugin("broken", [echoTool("ping")], () => Promise.reject(new Error("cannot spawn")));
    const skipped: Plugin = {
      name: "google",
      ready: () => Promise.resolve("no_oauth"),
      tools: () => {
        listed = true;
        return [echoTool("calendar_list_events")];
      },
    };
    const { registry, status } = await start([
      broken,
      skipped,
      fakePlugin("math", [echoTool("ping")]),
    ]);
    expect(status).toEqual({
      kind: "status",
      published: ["math"],
      skipped: [
        { name: "broken", reason: "connect" },
        { name: "google", reason: "no_oauth" },
      ],
    });
    expect(listed).toBe(false);
    expect(registry.toolCount()).toBe(1);
    expect(names(registry.list())).toEqual(["math__ping"]);
    const spawned = await registry.call("broken__missing", {}, callCtx());
    expect(textOf(spawned)).toContain("tool error [connect]");
    expect(textOf(spawned)).toContain("cannot spawn");
    expect(textOf(spawned)).toContain("do not invent broken__*");
    const oauth = await registry.call("google__calendar_list_events", {}, callCtx());
    expect(textOf(oauth)).toBe("tool error [no_oauth]: google is skipped — do not invent google__* names");
  });

  it("classifies a thrown key error and still starts when every plugin fails", async () => {
    const { status, registry } = await start([
      fakePlugin("maps", [echoTool("place_search")], () => Promise.reject(new Error("missing env GOOGLE_MAPS_API_KEY"))),
    ]);
    expect(status.published).toEqual([]);
    expect(status.skipped).toEqual([{ name: "maps", reason: "no_key" }]);
    expect(registry.toolCount()).toBe(0);
    const underscored = await registry.call("google_search__x", {}, callCtx());
    expect(textOf(underscored)).toContain("no such tool");
  });

  it("maps an underscored prefix onto a skipped hyphenated plugin", async () => {
    const { registry } = await start([
      fakePlugin("google-search", [], () => Promise.reject(new Error("missing env GOOGLE_MAPS_API_KEY"))),
    ]);
    const got = await registry.call("google_search__web_search", {}, callCtx());
    expect(textOf(got)).toContain("tool error [no_key]");
    expect(textOf(got)).toContain("do not invent google-search__*");
  });

  it("logs a missing key or a disabled plugin at info and a load failure at error", async () => {
    const boom: Plugin = {
      name: "boom",
      ready: () => Promise.resolve(null),
      tools: () => {
        throw new Error("tools exploded");
      },
    };
    const { sink } = await start([
      fakePlugin("strava", [], "no_key"),
      fakePlugin("garmin", [], "disabled"),
      fakePlugin("google", [], "no_oauth"),
      fakePlugin("broken", [], () => Promise.reject(new Error("cannot spawn"))),
      boom,
      fakePlugin("math", [echoTool("ping")]),
    ]);
    const skips = sink.records.filter((row) => row.message === "plugin skipped").map((row) => ({
      level: row.level,
      plugin: row.fields?.plugin,
      reason: row.fields?.reason,
    }));
    expect(skips).toEqual([
      { level: "info", plugin: "strava", reason: "no_key" },
      { level: "info", plugin: "garmin", reason: "disabled" },
      { level: "error", plugin: "google", reason: "no_oauth" },
      { level: "error", plugin: "broken", reason: "connect" },
      { level: "error", plugin: "boom", reason: "connect" },
    ]);
    expect(sink.records.some((row) => row.message === "mcp server boot skipped")).toBe(false);
  });

  it("skips a duplicate name and a tool-name collision without publishing a partial catalog", async () => {
    const { status, registry } = await start([
      fakePlugin("demo", [echoTool("a.b"), echoTool("a_b")]),
      fakePlugin("demo", [echoTool("other")]),
      fakePlugin("ok", [echoTool("ping")]),
    ]);
    expect(status.published).toEqual(["ok"]);
    expect(status.skipped.map((row) => row.name)).toEqual(["demo", "demo"]);
    expect(registry.toolCount()).toBe(1);
  });

  it("qualifies tool names and fills a missing schema", async () => {
    const bare: Tool = {
      name: "gmail.search",
      description: "mail",
      inputSchema: undefined as unknown as JsonSchema,
      call: () => Promise.resolve(textResult("ok")),
    };
    const { registry } = await start([fakePlugin("google-workspace", [bare])]);
    expect(registry.list()).toEqual([{
      name: "google-workspace__gmail_search",
      description: "mail",
      inputSchema: { type: "object", properties: {} },
    }]);
  });
});

describe("list order", () => {
  it("is sorted and stable", async () => {
    const tools = [
      "list_activities", "get_activity", "get_sleep", "get_weight",
      "get_body_battery", "get_training_readiness", "get_hrv", "get_steps",
      "get_stress", "get_vo2max", "get_races", "get_gear",
    ].map((name) => echoTool(name));
    const { registry } = await start([fakePlugin("garmin", tools)]);
    const first = names(registry.list());
    expect(first).toHaveLength(tools.length);
    const sorted = [...first].sort((a, b) => {
      if (a < b) {
        return -1;
      }
      if (a > b) {
        return 1;
      }
      return 0;
    });
    expect(sorted).toEqual(first);
    for (let i = 0; i < 20; i += 1) {
      expect(names(registry.list())).toEqual(first);
    }
  });
});

describe("call", () => {
  it("suggests the real catalog for an unknown tool on a real server", async () => {
    const { registry } = await start([
      fakePlugin("google-workspace", [echoTool("get_events"), echoTool("list_calendars")]),
    ]);
    const missing = await registry.call("google-workspace__get_calendar_event", {}, callCtx());
    const err = textOf(missing);
    for (const want of [
      "unknown tool \"google-workspace__get_calendar_event\"",
      "valid google-workspace tools include",
      "google-workspace__get_events",
      "google-workspace__list_calendars",
      "tool error:",
    ]) {
      expect(err).toContain(want);
    }
    const bogus = await registry.call("bogus__thing", {}, callCtx());
    expect(textOf(bogus)).toContain("available server prefixes are: google-workspace");
  });

  it("repairs a real tool suffix wearing an invented or missing prefix", async () => {
    const { registry } = await start([
      fakePlugin("garmin", [echoTool("hrv_get"), echoTool("sleep_get"), echoTool("activities_get")]),
      fakePlugin("strava", [echoTool("activities_get"), echoTool("athlete_get")]),
    ]);
    for (const name of ["mcp__hrv_get", "sleep_get", "GARMIN__hrv_get"]) {
      const out = await registry.call(name, {}, callCtx());
      expect(out.isError).toBeUndefined();
      expect(textOf(out)).toMatch(/hrv_get|sleep_get/);
    }
    const ambiguous = await registry.call("mcp__activities_get", {}, callCtx());
    expect(textOf(ambiguous)).toContain("garmin__activities_get");
    expect(textOf(ambiguous)).toContain("strava__activities_get");
    const crossed = await registry.call("garmin__athlete_get", {}, callCtx());
    expect(textOf(crossed)).toContain("valid garmin tools include");
    expect(textOf(crossed)).not.toContain("strava__athlete_get is the one");
  });

  it("keeps nearest-name candidates short instead of dumping the wrong server", async () => {
    const { registry } = await start([
      fakePlugin("google", [
        echoTool("calendar_list_events"),
        echoTool("calendar_get_event"),
        echoTool("calendar_delete_event"),
      ]),
      fakePlugin("strava", [
        echoTool("activities_list"),
        echoTool("activities_get"),
        echoTool("activities_get_streams"),
        echoTool("athlete_get"),
        echoTool("athlete_get_stats"),
        echoTool("activities_get_zones"),
      ]),
    ]);
    const got = await registry.call("strava__activities_get_event", {}, callCtx());
    expect(textOf(got)).toContain("valid strava tools include");
    expect(got.candidates?.length ?? 0).toBeLessThan(6);
    expect(got.candidates?.join(" ") ?? "").not.toBe(
      names(registry.list()).filter((name) => name.startsWith("strava__")).join(" "),
    );
  });

  it("ranks invented fragments toward the real tools", async () => {
    const { registry } = await start([
      fakePlugin("garmin", [
        echoTool("hrv_get"),
        echoTool("wellness_get_body_battery"),
        echoTool("sleep_get"),
        echoTool("activities_list"),
      ]),
    ]);
    const got = await registry.call("mcp__get_hrv_and_body_battery", {}, callCtx());
    const err = textOf(got);
    expect(err).toContain("closest real names are");
    const body = err.indexOf("garmin__wellness_get_body_battery");
    const hrv = err.indexOf("garmin__hrv_get");
    expect(body).toBeGreaterThanOrEqual(0);
    expect(hrv).toBeGreaterThan(body);
    expect(err).not.toContain("garmin__sleep_get");
    expect(err).not.toContain("garmin__activities_list");
    expect(got.candidates).toEqual(["garmin__wellness_get_body_battery", "garmin__hrv_get"]);
  });

  it("aliases an underscored prefix and does not rewrite the suffix", async () => {
    let calls = 0;
    const tool = echoTool("web_search");
    const counting: Tool = {
      ...tool,
      call: (args, ctx) => {
        calls += 1;
        return tool.call(args, ctx);
      },
    };
    const { registry, sink } = await start([fakePlugin("google-search", [counting])]);
    const exact = await registry.call("google-search__web_search", { query: "x" }, callCtx());
    expect(textOf(exact).startsWith("web_search:")).toBe(true);
    const aliased = await registry.call("google_search__web_search", { query: "edgeworks" }, callCtx());
    expect(textOf(aliased)).toContain("edgeworks");
    expect(calls).toBe(2);
    expect(sink.records.some((row) => row.message === "mcp tool name aliased")).toBe(true);
    const suffix = await registry.call("google-search__web-search", {}, callCtx());
    expect(textOf(suffix)).toContain("unknown tool");
    expect(calls).toBe(2);
  });

  it("suggests the hyphenated catalog when the prefix was underscored", async () => {
    const { registry } = await start([fakePlugin("google-search", [echoTool("web_search")])]);
    const err = textOf(await registry.call("google_search__google_search", {}, callCtx()));
    for (const want of [
      "unknown tool \"google_search__google_search\"",
      "did you mean \"google-search\"?",
      "valid google-search tools include",
      "google-search__web_search",
    ]) {
      expect(err).toContain(want);
    }
  });

  it("truncates model text and leaves callRaw intact", async () => {
    const big: Tool = {
      name: "big",
      description: "",
      inputSchema: { type: "object" },
      call: () => Promise.resolve(textResult("z".repeat(200))),
    };
    const { registry } = await start([fakePlugin("demo", [big])], { resultMaxChars: 40 });
    const out = textOf(await registry.call("demo__big", {}, callCtx()));
    expect(out).toContain("truncated");
    expect(out.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(Array.from(out).length).toBeLessThanOrEqual(40);
    const raw = textOf(await registry.callRaw("demo__big", {}, callCtx()));
    expect(raw).toBe("z".repeat(200));
  });

  it("uses the 6000 rune default cap", async () => {
    const big: Tool = {
      name: "big",
      description: "",
      inputSchema: { type: "object" },
      call: () => Promise.resolve(textResult("z".repeat(6001))),
    };
    const sql = memSql();
    const registry = new Registry([fakePlugin("demo", [big])], testContext(sql, testClock()), { dynamicTools: false });
    await registry.publish();
    const out = textOf(await registry.call("demo__big", {}, callCtx()));
    expect(Array.from(out).length).toBe(6000);
    expect(out.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("turns a classified tool failure into tool-error text and does not retry", async () => {
    let calls = 0;
    const tool: Tool = {
      name: "echo",
      description: "",
      inputSchema: { type: "object" },
      call: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new Error("EOF"));
        }
        return Promise.resolve(textResult("again"));
      },
    };
    const { registry } = await start([fakePlugin("demo", [tool])]);
    const eof = await registry.call("demo__echo", {}, callCtx());
    expect(textOf(eof)).toBe("tool error: EOF");
    expect(calls).toBe(1);
    const denied: Tool = {
      name: "auth",
      description: "",
      inputSchema: { type: "object" },
      call: () => Promise.resolve(errorResult("401 unauthorized")),
    };
    const { registry: second } = await start([fakePlugin("demo", [denied])]);
    expect(textOf(await second.call("demo__auth", {}, callCtx()))).toContain("tool error [no_oauth]:");
  });

  it("rejects when the call signal aborts and does not start a second call", async () => {
    let calls = 0;
    let started = (): void => undefined;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const tool: Tool = {
      name: "echo",
      description: "",
      inputSchema: { type: "object" },
      call: () => {
        calls += 1;
        started();
        return new Promise(() => undefined);
      },
    };
    const { registry } = await start([fakePlugin("demo", [tool])]);
    const ac = new AbortController();
    const pending = registry.call("demo__echo", {}, callCtx({ signal: ac.signal }));
    await entered;
    ac.abort();
    await expect(pending).rejects.toThrow(/abort/i);
    expect(calls).toBe(1);

    const already = new AbortController();
    already.abort();
    await expect(registry.call("demo__echo", {}, callCtx({ signal: already.signal }))).rejects.toThrow(/abort/i);
    expect(calls).toBe(1);
  });

  it("runs two calls without a per-plugin lock", async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let inflight = 0;
    let peak = 0;
    const tool: Tool = {
      name: "go",
      description: "",
      inputSchema: { type: "object" },
      call: async () => {
        inflight += 1;
        peak = Math.max(peak, inflight);
        await gate;
        inflight -= 1;
        return textResult("ok");
      },
    };
    const { registry } = await start([fakePlugin("search", [tool])]);
    const pending = Promise.all([
      registry.call("search__go", {}, callCtx()),
      registry.call("search__go", {}, callCtx()),
    ]);
    await waitFor(() => peak === 2);
    release();
    const [a, b] = await pending;
    expect(textOf(a)).toBe("ok");
    expect(textOf(b)).toBe("ok");
  });

  it("keeps photo bytes out of the model text and returns a data URL", async () => {
    const tool: Tool = {
      name: "photo_generate",
      description: "",
      inputSchema: { type: "object" },
      call: () => Promise.resolve({
        content: [
          { type: "text", text: "{\"prompt\":\"red bike\"}" },
          { type: "image", data: "iVBOR", mimeType: "image/png" },
        ],
      }),
    };
    const { registry } = await start([fakePlugin("image", [tool])]);
    const got = await registry.call("image__photo_generate", {}, callCtx());
    expect(textOf(got)).toContain("delivered to chat");
    expect(textOf(got)).not.toContain("iVBOR");
    expect(got.images).toEqual(["data:image/png;base64,iVBOR"]);
  });
});

describe("session enable", () => {
  it("hides plugins until mcp_enable and then calls them", async () => {
    const sql = memSql();
    const clock = testClock();
    const sink = memorySink();
    const ctx = testContext(sql, clock, sink);
    const store = new EnableStore(sql, clock);
    const registry = new Registry(
      [fakePlugin("demo", [echoTool("echo")])],
      ctx,
      { enable: store, builtins: [echoTool("memory_store")], forcePrefixes: ["flights"] },
    );
    await registry.publish();
    const hidden = names(registry.list());
    expect(hidden[0]).toBe("mcp_enable");
    expect(hidden).toContain("memory_store");
    expect(hidden).not.toContain("demo__echo");

    const blocked = await registry.call("demo__echo", {}, callCtx({ sessionId: "room" }));
    expect(textOf(blocked)).toContain("not enabled — call mcp_enable with prefixes=[demo]");
    expect(blocked.isError).toBe(true);

    const enabled = await registry.call("mcp_enable", { prefixes: ["demo"] }, callCtx({ sessionId: "room" }));
    expect(textOf(enabled)).toContain("enabled demo (short)");
    expect(names(registry.list(["demo"]))).toContain("demo__echo");
    const out = await registry.call("demo__echo", { q: "hi" }, callCtx({ sessionId: "room" }));
    expect(textOf(out)).toContain("echo:");
    expect(textOf(out)).toContain("hi");

    const open = await registry.call("demo__echo", {}, callCtx({ sessionId: "" }));
    expect(textOf(open)).toContain("echo:");
  });

  it("publishes a force prefix without a session row", async () => {
    const sql = memSql();
    const registry = new Registry(
      [fakePlugin("flights", [echoTool("offers_search")])],
      testContext(sql, testClock()),
      { enable: new EnableStore(sql, testClock()), forcePrefixes: ["flights"] },
    );
    await registry.publish();
    expect(names(registry.list())).toContain("flights__offers_search");
    const out = await registry.call("flights__offers_search", {}, callCtx({ sessionId: "room" }));
    expect(out.isError).toBeUndefined();
  });
});

async function waitFor(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (ready()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 1);
    });
  }
  throw new Error("timed out waiting");
}
