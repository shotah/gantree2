import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrain } from "@/brain/agent";
import type { BrainDeps } from "@/brain/core/brain";
import type { LogFrame } from "@/brain/core/wire";
import { allPlugins } from "@/brain/plugins";
import { AesTokenStore, TOKEN_KEY_STORE_KEY, tokenKeyOk } from "@/brain/tools";
import { CONFIG_STORE_KEY } from "@/lib/agents/config";
import { dropRoomBrain, openRoomBrain } from "@/brain/room";
import { roomAuth } from "@/brain/room/authbind";

vi.mock("@/brain/agent", () => ({
  createBrain: vi.fn(() => ({
    handleInbound: async () => undefined,
    alarm: async () => null,
    nextAlarm: () => null,
    announce: async () => undefined,
    authStart: async () => null,
    authFinish: async () => undefined,
  })),
}));

const PLUGIN_NAMES = [
  "chat",
  "feeds",
  "math",
  "twitter",
  "image",
  "strava",
  "maps",
  "flights",
  "rentals",
  "google-health",
  "google",
  "garmin",
];

function sqlStorage() {
  const db = new DatabaseSync(":memory:");
  return {
    exec(query: string, ...params: unknown[]) {
      const stmt = db.prepare(query);
      const head = query.trimStart().slice(0, 6).toUpperCase();
      const reads = head.startsWith("SELECT") || head.startsWith("WITH") || head.startsWith("PRAGMA") || /\bRETURNING\b/i.test(query);
      if (reads) {
        const rows = stmt.all(...(params as []));
        return { toArray: () => rows, rowsWritten: 0 };
      }
      const result = stmt.run(...(params as []));
      return { toArray: () => [], rowsWritten: Number(result.changes) };
    },
  };
}

function ctxFor(rows: Map<string, unknown>) {
  return {
    storage: {
      sql: sqlStorage(),
      get: (key: string) => Promise.resolve(rows.get(key)),
      put: (key: string, value: unknown) => {
        rows.set(key, value);
        return Promise.resolve();
      },
    },
  };
}

function depsOf(): BrainDeps {
  const call = vi.mocked(createBrain).mock.calls.at(-1);
  if (!call) {
    throw new Error("createBrain was not called");
  }
  return call[0];
}

afterEach(() => {
  vi.mocked(createBrain).mockClear();
});

describe("openRoomBrain", () => {
  it("builds deps from the DO and reuses the brain until env or persona changes", async () => {
    const rows = new Map<string, unknown>();
    rows.set("slug", "kit");
    rows.set(CONFIG_STORE_KEY, {
      env: { LLM_MODEL: "mine", LLM_API_KEY: "mine-key", CRON_TZ: "America/Chicago" },
      mcp: "",
      persona: "- **Timezone:** America/Denver\n",
      runtime: "native",
      updatedAt: 1,
    });
    const ctx = ctxFor(rows);
    const logs: LogFrame[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const first = await openRoomBrain(ctx as unknown as DurableObjectState, {
      LLM_API_KEY: "house-key",
      LLM_BASE_URL: "https://llm.example/v1",
      LLM_MODEL: "house-model",
    }, {
      foldLog: (frame) => {
        logs.push(frame);
      },
    });
    const again = await openRoomBrain(ctx as unknown as DurableObjectState, {
      LLM_API_KEY: "house-key",
      LLM_BASE_URL: "https://llm.example/v1",
      LLM_MODEL: "house-model",
    }, {
      foldLog: (frame) => {
        logs.push(frame);
      },
    });
    expect(again).toBe(first);
    expect(vi.mocked(createBrain)).toHaveBeenCalledTimes(1);

    const deps = depsOf();
    expect(deps.slug).toBe("kit");
    expect(deps.clock.zone).toBe("America/Denver");
    expect(deps.fetch.name).toBe("bound fetch");
    expect(deps.persona).toEqual([{ name: "PERSONA.md", text: "- **Timezone:** America/Denver\n" }]);
    expect(deps.env.LLM_MODEL).toBe("mine");
    expect(deps.env.LLM_API_KEY).toBe("mine-key");
    expect(deps.env.LLM_BASE_URL).toBe("https://llm.example/v1");
    expect(deps.env.SNAPSHOT_KEY).toBeUndefined();
    expect(tokenKeyOk(String(rows.get(TOKEN_KEY_STORE_KEY)))).toBe(true);
    expect(deps.tokens).toBeInstanceOf(AesTokenStore);
    const math = deps.plugins.find((plugin) => plugin.name === "math");
    expect(await math?.ready({} as never)).toBe("disabled");
    expect(deps.plugins.map((plugin) => plugin.name)).toEqual(PLUGIN_NAMES);
    expect(allPlugins.map((plugin) => plugin.name)).toEqual(PLUGIN_NAMES);
    expect(typeof deps.provider.complete).toBe("function");

    deps.log.info("booted");
    expect(logs).toContainEqual(expect.objectContaining({ kind: "log", level: "info", message: "booted slug=kit" }));
    deps.log.info("mcp server connected", { server: "maps", tools_published: 2 });
    expect(logs.at(-1)?.message).toBe("mcp server connected slug=kit server=maps tools_published=2");
    deps.log.info("maps skipped: no_key", { server: "maps", reason: "no_key" });
    expect(logs.at(-1)?.message).toBe("maps skipped: no_key slug=kit");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();

    rows.set(CONFIG_STORE_KEY, {
      env: { LLM_MODEL: "mine", LLM_API_KEY: "mine-key", CRON_TZ: "America/Chicago" },
      mcp: "",
      persona: "replaced too late",
      runtime: "native",
      updatedAt: 2,
    });
    const stuck = await openRoomBrain(ctx as unknown as DurableObjectState, {
      LLM_API_KEY: "house-key",
      LLM_BASE_URL: "https://llm.example/v1",
      LLM_MODEL: "house-model",
    }, { foldLog: () => undefined });
    expect(stuck).toBe(first);
    expect(vi.mocked(createBrain)).toHaveBeenCalledTimes(1);

    rows.set(CONFIG_STORE_KEY, {
      env: { LLM_MODEL: "mine", LLM_API_KEY: "mine-key" },
      mcp: "",
      persona: "no zone here",
      runtime: "native",
      updatedAt: 3,
    });
    const rebuilt = await openRoomBrain(ctx as unknown as DurableObjectState, {
      LLM_MODEL: "house-model",
    }, { foldLog: () => undefined });
    expect(rebuilt).not.toBe(first);
    expect(depsOf().persona).toEqual([{ name: "PERSONA.md", text: "- **Timezone:** America/Denver\n" }]);
    expect(depsOf().clock.zone).toBe("America/Denver");
    expect(vi.mocked(createBrain)).toHaveBeenCalledTimes(2);

    ctx.storage.sql.exec("UPDATE persona_file SET text = ? WHERE name = ?", "no zone here", "PERSONA.md");
    ctx.storage.sql.exec(
      "INSERT INTO persona_file (name, text, updated_at) VALUES (?, ?, ?)",
      "SOUL.md",
      "legacy soul",
      1,
    );
    const edited = await openRoomBrain(ctx as unknown as DurableObjectState, {
      LLM_MODEL: "house-model",
    }, { foldLog: () => undefined });
    expect(edited).not.toBe(rebuilt);
    expect(depsOf().persona).toEqual([
      { name: "PERSONA.md", text: "no zone here" },
      { name: "SOUL.md", text: "legacy soul" },
    ]);
    expect(depsOf().clock.zone).toBe("America/Los_Angeles");
    expect(vi.mocked(createBrain)).toHaveBeenCalledTimes(3);

    dropRoomBrain(ctx as unknown as DurableObjectState);
    await openRoomBrain(ctx as unknown as DurableObjectState, {
      LLM_MODEL: "house-model",
    }, { foldLog: () => undefined });
    expect(vi.mocked(createBrain)).toHaveBeenCalledTimes(4);
  });

  it("binds the catch redirect on the sql object slash will see", async () => {
    const rows = new Map<string, unknown>();
    rows.set(CONFIG_STORE_KEY, {
      env: { LLM_API_KEY: "mine-key" },
      mcp: "",
      persona: "",
      runtime: "native",
      updatedAt: 1,
    });
    const seal = vi.fn((plugin: string) => Promise.resolve(`sealed:${plugin}`));
    await openRoomBrain(ctxFor(rows) as unknown as DurableObjectState, {
      LLM_API_KEY: "house-key",
    }, {
      slug: "kit",
      foldLog: () => undefined,
      auth: {
        redirectUri: () => "https://gantree2.bldhosting.com/api/auth/catch",
        sealState: seal,
      },
    });
    const bound = roomAuth(depsOf().sql);
    expect(bound?.redirectUri()).toBe("https://gantree2.bldhosting.com/api/auth/catch");
    expect(await bound?.sealState("google")).toBe("sealed:google");
    expect(depsOf().env.OAUTH_REDIRECT_URI).toBeUndefined();
  });

  it("rebuilds when the grant list changes and publishes the granted plugin", async () => {
    const rows = new Map<string, unknown>();
    rows.set("slug", "kit");
    rows.set(CONFIG_STORE_KEY, { env: {}, mcp: "", persona: "", updatedAt: 1 });
    const ctx = ctxFor(rows);
    const opts = { foldLog: () => undefined };
    const house = { LLM_API_KEY: "house-key" };
    await openRoomBrain(ctx as unknown as DurableObjectState, house, opts);
    expect(await depsOf().plugins.find((plugin) => plugin.name === "math")?.ready({} as never)).toBe("disabled");

    rows.set(CONFIG_STORE_KEY, {
      env: {},
      mcp: "[[server]]\nname = \"math\"\ncommand = \"math\"\n",
      persona: "",
      updatedAt: 2,
    });
    await openRoomBrain(ctx as unknown as DurableObjectState, house, opts);
    expect(vi.mocked(createBrain)).toHaveBeenCalledTimes(2);
    expect(await depsOf().plugins.find((plugin) => plugin.name === "math")?.ready({} as never)).toBeNull();

    rows.set(CONFIG_STORE_KEY, { env: {}, mcp: "", persona: "", updatedAt: 3 });
    await openRoomBrain(ctx as unknown as DurableObjectState, house, opts);
    expect(vi.mocked(createBrain)).toHaveBeenCalledTimes(3);
    expect(await depsOf().plugins.find((plugin) => plugin.name === "math")?.ready({} as never)).toBe("disabled");
  });
});
