import { describe, expect, it } from "vitest";
import { AGENTS_SQL, openRegistry } from "@/lib/agents/registry";
import type { Sql } from "@/lib/door/settingsStore";
import { memorySql } from "../door/memorySql";

const ADA = "118212345678901234567";

describe("agents table", () => {
  it("creates the inventory and audits add and remove", async () => {
    const sql = memorySql();
    const registry = openRegistry(sql, () => 40);
    openRegistry(sql, () => 40);
    expect(AGENTS_SQL).toContain("slug TEXT PRIMARY KEY");
    expect(AGENTS_SQL).toContain("tags TEXT /*json array*/");
    const names = sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").toArray();
    expect(names.map((row) => row.name)).toEqual(["agents", "audit"]);

    const created = await registry.create({ slug: " Kit ", name: " Kit ", tags: [" house ", "house", "keys"] }, ADA);
    expect(created).toEqual({
      ok: true,
      agent: { slug: "kit", name: "Kit", createdBy: ADA, createdAt: 40, tags: ["house", "keys"] },
    });
    expect(await registry.create({ slug: "kit", name: "" }, ADA)).toEqual({ ok: false, error: "exists" });
    expect(await registry.get("KIT")).toMatchObject({ name: "Kit", tags: ["house", "keys"] });
    expect(await registry.get("nope_slug")).toBeNull();
    expect(await registry.remove("missing", ADA)).toEqual({ ok: false, error: "not_found" });
    expect(await registry.remove("KIT", `${ADA}'`)).toEqual({ ok: true });
    expect(await registry.list()).toEqual([]);
    const events = sql.exec("SELECT who, action, detail FROM audit ORDER BY id ASC").toArray();
    expect(events.map((row) => row.action)).toEqual(["agent.add", "agent.remove"]);
    expect(events[1]?.who).toBe(`${ADA}'`);
    expect(JSON.parse(String(events[0]?.detail))).toMatchObject({ slug: "kit", name: "Kit", tags: ["house", "keys"] });
  });

  it("rejects bad slugs, names, and tags without writing", async () => {
    const registry = openRegistry(memorySql(), () => 1);
    expect(await registry.create({ slug: "1kit" }, ADA)).toEqual({ ok: false, error: "bad_slug" });
    expect(await registry.create({ slug: "kit", name: 1 }, ADA)).toEqual({ ok: false, error: "bad_name" });
    expect(await registry.create({ slug: "kit", name: "x".repeat(81) }, ADA)).toEqual({ ok: false, error: "bad_name" });
    expect(await registry.create({ slug: "kit", name: "bad\nname" }, ADA)).toEqual({ ok: false, error: "bad_name" });
    expect(await registry.create({ slug: "kit", tags: "house" }, ADA)).toEqual({ ok: false, error: "bad_tags" });
    expect(await registry.create({ slug: "kit", tags: ["ok", 1] }, ADA)).toEqual({ ok: false, error: "bad_tags" });
    expect(await registry.create({ slug: "kit", tags: ["bad\ntag"] }, ADA)).toEqual({ ok: false, error: "bad_tags" });
    expect(await registry.create({ slug: "kit", tags: ["x".repeat(65)] }, ADA)).toEqual({ ok: false, error: "bad_tags" });
    expect(await registry.create({ slug: "kit", tags: Array.from({ length: 33 }, (_, i) => `t${i}`) }, ADA)).toEqual({ ok: false, error: "bad_tags" });
    expect(await registry.create({ slug: "kit" }, 12 as unknown as string)).toMatchObject({ ok: true, agent: { name: "kit", createdBy: "" } });
    expect(await registry.remove("nope_slug", ADA)).toEqual({ ok: false, error: "bad_slug" });
    expect(await registry.list()).toHaveLength(1);
  });

  it("skips corrupt rows and reads a bigint timestamp", async () => {
    const all = [
      { slug: "kit", name: "Kit", created_by: ADA, created_at: 9n, tags: "[\"a\"]" },
      { slug: "bad slug", name: "X", created_by: ADA, created_at: 1, tags: "[]" },
      { slug: "ada", name: "Ada", created_by: null, created_at: 2, tags: "{" },
      { slug: "zed", name: 1, created_by: ADA, created_at: 3, tags: "[]" },
    ];
    const sql: Sql = {
      exec(query, ...binds) {
        if (query.includes("FROM agents WHERE")) {
          return { toArray: () => all.filter((row) => row.slug === binds[0]) };
        }
        if (query.includes("FROM agents")) {
          return { toArray: () => all };
        }
        return { toArray: () => [] };
      },
    };
    const registry = openRegistry(sql, () => 1);
    expect(await registry.list()).toEqual([
      { slug: "kit", name: "Kit", createdBy: ADA, createdAt: 9, tags: ["a"] },
      { slug: "ada", name: "Ada", createdBy: "", createdAt: 2, tags: [] },
    ]);
    expect(await registry.get("kit")).toMatchObject({ createdAt: 9, tags: ["a"] });
    expect(await registry.get("missing")).toBeNull();
  });
});
