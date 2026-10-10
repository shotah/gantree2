import { describe, expect, it, vi } from "vitest";
import { memorySql } from "../door/memorySql";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class DurableObject {
    constructor(_ctx: unknown, _env: unknown) {}
  },
}));

import { Settings } from "@/edge/settings.do";

describe("Settings", () => {
  it("puts, lists, audits, and removes through the SQL handle", async () => {
    const sql = memorySql();
    const settings = new Settings({ storage: { sql } } as DurableObjectState, {});
    expect(await settings.listUsers()).toEqual([]);

    const added = await settings.putUser({ entry: "Eve@Example.com", role: "operator", agents: ["Kit"] }, "118212345678901234567");
    expect(added).toMatchObject({
      ok: true,
      user: { entry: { email: "eve@example.com" }, role: "operator", agents: ["kit"], locked: false },
    });
    expect(await settings.listUsers()).toHaveLength(1);

    const updated = await settings.putUser({ entry: "eve@example.com", role: "member" }, "118212345678901234567");
    expect(updated).toMatchObject({ ok: true, user: { role: "member", agents: [] } });
    const events = await settings.audit(10);
    expect(events.map((event) => event.action)).toEqual(["user.update", "user.add"]);

    expect(await settings.removeUser("eve@example.com", "118212345678901234567")).toEqual({ ok: true });
    expect(await settings.listUsers()).toEqual([]);
    expect(await settings.removeUser("eve@example.com", "118212345678901234567")).toEqual({ ok: false, error: "not_found" });
    expect(await settings.putUser({ entry: "nope", role: "member" }, "ada")).toEqual({ ok: false, error: "bad_entry" });
    expect((await settings.audit(1))[0]).toMatchObject({ action: "user.remove" });
  });

  it("stores agents and samples beside the user list", async () => {
    const sql = memorySql();
    const settings = new Settings({ storage: { sql } } as DurableObjectState, {});
    const created = await settings.createAgent({ slug: "Kit", name: " Kit ", tags: ["house", "house"] }, "118212345678901234567");
    expect(created).toMatchObject({ ok: true, agent: { slug: "kit", name: "Kit", tags: ["house"] } });
    expect(await settings.getAgent("kit")).toMatchObject({ slug: "kit" });
    expect(await settings.listAgents()).toHaveLength(1);
    expect(await settings.createAgent({ slug: "kit" }, "ada")).toEqual({ ok: false, error: "exists" });

    const sample = await settings.addSample({ agent: "kit", kind: "turn", value: 1 });
    expect(sample).toMatchObject({ ok: true, sample: { agent: "kit", kind: "turn" } });
    expect(await settings.listSamples({ agent: "kit" })).toHaveLength(1);

    expect(await settings.deleteAgent("kit", "ada")).toEqual({ ok: true });
    expect(await settings.listAgents()).toEqual([]);
    expect(await settings.listSamples({ agent: "kit" })).toHaveLength(1);
    expect((await settings.audit(1))[0]).toMatchObject({ action: "agent.remove" });
  });
});
