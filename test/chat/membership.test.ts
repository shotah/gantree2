import { describe, expect, it } from "vitest";
import type { DirectoryKv } from "@/lib/chat/directory";
import { roomsFor } from "@/lib/chat/membership";
import type { Principal } from "@/lib/door/gate";
import { settingsInventory } from "./settingsStub";

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
    const env = {
      DIRECTORY: kvOf({ "sub:118200000000000000001": "[\"ada\"]", "email:ada@example.com": "[\"kit\"]" }),
      SETTINGS: settingsInventory(["ada", "kit"]),
    };
    expect(await roomsFor(env)(ada)).toEqual(["ada", "kit"]);
  });

  it("with no AGENT binding a granted slug is only a candidate, not membership", async () => {
    const env = { DIRECTORY: kvOf({}) };
    expect(await roomsFor(env)(ada)).toEqual([]);
  });

  it("works with no directory at all", async () => {
    expect(await roomsFor({})({ ...ada, agents: [] })).toEqual([]);
  });

  it("lists every inventoried agent for an admin", async () => {
    const admin: Principal = { ...ada, role: "admin", agents: [] };
    const env = {
      DIRECTORY: kvOf({}),
      SETTINGS: {
        getByName: () => ({
          listAgents: async () => [{ slug: "kit", name: "Kit", status: "idle" as const, createdAt: 0, updatedAt: 0 }],
        }),
      } as unknown as DurableObjectNamespace,
    };
    expect(await roomsFor(env)(admin)).toEqual(["kit"]);
  });

  it("intersects operator assignment with the inventory", async () => {
    const op: Principal = { ...ada, role: "operator", agents: ["kit"] };
    const env = {
      SETTINGS: {
        getByName: () => ({
          listAgents: async () => [
            { slug: "kit", name: "Kit", status: "idle" as const, createdAt: 0, updatedAt: 0 },
            { slug: "ada", name: "Ada", status: "idle" as const, createdAt: 0, updatedAt: 0 },
          ],
        }),
      } as unknown as DurableObjectNamespace,
    };
    expect(await roomsFor(env)(op)).toEqual(["kit"]);
  });
});
