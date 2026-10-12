import { describe, expect, it } from "vitest";
import type { DirectoryKv } from "@/lib/chat/directory";
import { roomsFor } from "@/lib/chat/membership";
import type { Principal } from "@/lib/door/gate";

function kvOf(rows: Record<string, string>): DirectoryKv {
  const m = new Map(Object.entries(rows));
  return {
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => {
      m.set(k, v);
    },
    delete: async (k) => {
      m.delete(k);
    },
  };
}

const ada: Principal = { sub: "118200000000000000001", email: "ada@example.com", role: "member", agents: ["kit"], entry: { sub: "118200000000000000001", email: "ada@example.com" } };

describe("roomsFor", () => {
  it("reads the KV directory for the person", async () => {
    const env = { DIRECTORY: kvOf({ "sub:118200000000000000001": "[\"ada\"]", "email:ada@example.com": "[\"kit\"]" }) };
    expect(await roomsFor(env)(ada)).toEqual(["ada", "kit"]);
  });

  it("with no AGENT binding a granted slug is only a candidate, not membership", async () => {
    const env = { DIRECTORY: kvOf({}) };
    expect(await roomsFor(env)(ada)).toEqual([]);
  });

  it("works with no directory at all", async () => {
    expect(await roomsFor({})({ ...ada, agents: [] })).toEqual([]);
  });

  it("unions household agents for a floor match when Settings lists them", async () => {
    const env = {
      GANTREE_ADMINS: "ada@example.com",
      DIRECTORY: kvOf({}),
      SETTINGS: {
        getByName: () => ({
          listAgents: async () => [{ slug: "kit", name: "Kit", status: "idle" as const, createdAt: 0, updatedAt: 0 }],
        }),
      },
    };
    expect(await roomsFor(env)(ada)).toEqual(["kit"]);
  });
});
