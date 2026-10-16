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

  it("lists Who can chat for an admin, not the whole inventory", async () => {
    const admin: Principal = { ...ada, role: "admin", agents: [] };
    const env = {
      DIRECTORY: kvOf({ "email:ada@example.com": "[\"kit\"]" }),
      SETTINGS: settingsInventory(["kit", "ada"]),
    };
    expect(await roomsFor(env)(admin)).toEqual(["kit"]);
  });

  it("lists Who can chat for an operator, not the agents on their row", async () => {
    const op: Principal = { ...ada, role: "operator", agents: ["ada"] };
    const env = {
      DIRECTORY: kvOf({ "sub:118200000000000000001": "[\"kit\"]" }),
      SETTINGS: settingsInventory(["kit", "ada"]),
    };
    expect(await roomsFor(env)(op)).toEqual(["kit"]);
  });
});
