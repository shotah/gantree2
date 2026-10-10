import { describe, expect, it } from "vitest";
import {
  admittedAgents,
  agentsFor,
  directoryApply,
  directoryDiff,
  directoryEmailKey,
  directoryIdle,
  directoryRemember,
  directorySubKey,
  parseSlugSet,
  roomMembership,
  type DirectoryKv,
} from "@/lib/chat/directory";

function memoryKv(init?: Record<string, string>): DirectoryKv & { store: Map<string, string> } {
  const store = new Map(Object.entries(init ?? {}));
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => {
      store.delete(key);
    },
  };
}

describe("directory", () => {
  it("diffs added and removed subs and emails", () => {
    expect(directoryDiff(
      [{ sub: "118212345678901234567", email: "ada@example.com" }, { email: "bob@example.com" }],
      [{ sub: "118212345678901234567", email: "ada@example.com" }],
    )).toEqual({
      addSubs: [],
      dropSubs: [],
      addEmails: [],
      dropEmails: ["bob@example.com"],
    });
    expect(directoryDiff([], [{ email: "ada@example.com" }, { sub: "118212345678901234567" }])).toEqual({
      addSubs: ["118212345678901234567"],
      dropSubs: [],
      addEmails: ["ada@example.com"],
      dropEmails: [],
    });
  });

  it("writes this slug onto current keys and drops it from removed ones", async () => {
    const kv = memoryKv();
    await directoryApply(kv, "kit", [], [
      { sub: "118212345678901234567", email: "ada@example.com" },
      { email: "bob@example.com" },
    ]);
    expect(parseSlugSet(await kv.get(directorySubKey("118212345678901234567")))).toEqual(new Set(["kit"]));
    expect(parseSlugSet(await kv.get(directoryEmailKey("ada@example.com")))).toEqual(new Set(["kit"]));
    expect(parseSlugSet(await kv.get(directoryEmailKey("bob@example.com")))).toEqual(new Set(["kit"]));

    await directoryApply(kv, "kit", [
      { sub: "118212345678901234567", email: "ada@example.com" },
      { email: "bob@example.com" },
    ], [{ email: "ada@example.com" }]);
    expect(await kv.get(directorySubKey("118212345678901234567"))).toBeNull();
    expect(await kv.get(directoryEmailKey("bob@example.com"))).toBeNull();
    expect(parseSlugSet(await kv.get(directoryEmailKey("ada@example.com")))).toEqual(new Set(["kit"]));
  });

  it("leaves a sibling slug on a shared email when this room drops it", async () => {
    const kv = memoryKv();
    await directoryApply(kv, "kit", [], [{ email: "ada@example.com" }]);
    await directoryApply(kv, "ada", [], [{ email: "ada@example.com" }]);
    await directoryApply(kv, "kit", [{ email: "ada@example.com" }], []);
    expect(parseSlugSet(await kv.get(directoryEmailKey("ada@example.com")))).toEqual(new Set(["ada"]));
  });

  it("skips a no-op rewrite and a bad slug", async () => {
    const kv = memoryKv();
    await directoryApply(kv, "kit", [], [{ email: "ada@example.com" }]);
    const before = await kv.get(directoryEmailKey("ada@example.com"));
    await directoryApply(kv, "kit", [{ email: "ada@example.com" }], [{ email: "ada@example.com" }]);
    expect(await kv.get(directoryEmailKey("ada@example.com"))).toBe(before);
    await directoryApply(kv, "!!", [], [{ email: "ada@example.com" }]);
    expect(await kv.get(directoryEmailKey("ada@example.com"))).toBe(before);
  });

  it("parses slug sets and drops junk", () => {
    expect(parseSlugSet(null).size).toBe(0);
    expect(parseSlugSet("  ").size).toBe(0);
    expect(parseSlugSet("{").size).toBe(0);
    expect(parseSlugSet("{}").size).toBe(0);
    expect(parseSlugSet(JSON.stringify([1, "nope!", "Kit", "ada"]))).toEqual(new Set(["kit", "ada"]));
  });

  it("unions sub and email slugs for /me", async () => {
    const kv = memoryKv({
      [directorySubKey("1182")]: JSON.stringify(["kit"]),
      [directoryEmailKey("ada@example.com")]: JSON.stringify(["ada", "kit"]),
    });
    expect(await agentsFor(kv, "1182", "ada@example.com")).toEqual(["ada", "kit"]);
    expect(await agentsFor(kv, "9999")).toEqual([]);
    expect(await agentsFor(kv, "1182", "   ")).toEqual(["kit"]);
  });

  it("re-indexes a stored room onto KV on harness reconnect", async () => {
    const kv = memoryKv();
    expect(await directoryRemember(undefined, "tim", [{ email: "ada@example.com" }])).toBe(true);
    expect(await directoryRemember(kv, "tim", [])).toBe(true);
    expect(await directoryRemember(kv, "tim", [{ email: "ada@example.com" }])).toBe(true);
    expect(parseSlugSet(await kv.get(directoryEmailKey("ada@example.com")))).toEqual(new Set(["tim"]));
  });

  it("swallows a KV write miss on remember", async () => {
    const kv: DirectoryKv = {
      get: async () => null,
      put: async () => {
        throw new Error("limit");
      },
      delete: async () => undefined,
    };
    await expect(directoryRemember(kv, "kit", [{ email: "ada@example.com" }])).resolves.toBe(false);
  });

  it("adds a typed slug only when the room admits", async () => {
    const kv = memoryKv({
      [directorySubKey("1182")]: JSON.stringify(["kit"]),
    });
    const rooms = new Map<string, { email?: string }[]>([
      ["tim", [{ email: "ada@example.com" }]],
      ["ghost", []],
    ]);
    const session = { sub: "1182", email: "ada@example.com", emailVerified: true };
    expect(await admittedAgents({
      kv,
      slugs: ["tim", "ghost", "NOPE"],
      session,
      rooms: async (slug) => rooms.get(slug) ?? [],
    })).toEqual(["kit", "tim"]);
    expect(await admittedAgents({
      kv,
      slugs: ["ghost"],
      session,
      rooms: async (slug) => rooms.get(slug) ?? [],
    })).toEqual(["kit"]);
    expect(await admittedAgents({
      slugs: ["tim"],
      session,
      rooms: async () => [{ email: "ada@example.com" }],
    })).toEqual(["tim"]);
  });

  it("does not probe slugs that were not passed", async () => {
    const probed: string[] = [];
    const kv = memoryKv({
      [directorySubKey("1182")]: JSON.stringify(["kit"]),
    });
    expect(await admittedAgents({
      kv,
      slugs: [],
      session: { sub: "1182" },
      rooms: async (slug) => {
        probed.push(slug);
        return [];
      },
    })).toEqual(["kit"]);
    expect(probed).toEqual([]);
    expect(directoryIdle(
      [{ email: "ada@example.com" }],
      [{ email: "ada@example.com" }],
    )).toBe(true);
    expect(directoryIdle([], [{ email: "ada@example.com" }])).toBe(false);
  });

  it("emits agents and a cranes alias copy", () => {
    const body = roomMembership(["ada", "kit"]);
    expect(body).toEqual({ agents: ["ada", "kit"], cranes: ["ada", "kit"] });
    body.agents.push("nope");
    expect(body.cranes).toEqual(["ada", "kit"]);
  });
});
