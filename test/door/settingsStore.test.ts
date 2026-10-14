import { describe, expect, it } from "vitest";
import { canRunAgent, resolveUser } from "@/lib/door/users";
import {
  AUDIT_SQL,
  PLATFORM_SECRET_SQL,
  SAMPLES_SQL,
  USERS_SQL,
  asSql,
  openSettings,
  type SampleInput,
  type Sql,
} from "@/lib/door/settingsStore";
import { memorySql } from "./memorySql";

const ADA = "118212345678901234567";
const EVE = { sub: "338212345678901234567", email: "eve@example.com", emailVerified: true };

describe("schema", () => {
  it("creates users, audit, and samples", () => {
    expect(USERS_SQL).toContain("entry TEXT PRIMARY KEY");
    expect(USERS_SQL).toContain("agents TEXT /*json array*/");
    expect(AUDIT_SQL).toContain("id INTEGER PRIMARY KEY");
    expect(SAMPLES_SQL).toContain("value REAL");
    expect(PLATFORM_SECRET_SQL).toContain("platform_secret");
    const sql = memorySql();
    openSettings(sql);
    openSettings(sql);
    const names = sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").toArray();
    expect(names.map((row) => row.name)).toEqual(["audit", "platform_secret", "samples", "users"]);
  });
});

describe("asSql", () => {
  it("forwards the statement and copies rows onto plain objects", () => {
    const calls: unknown[][] = [];
    const sql: Sql = {
      exec(query, ...binds) {
        calls.push([query, ...binds]);
        const row = Object.create(null) as Record<string, unknown>;
        row.entry = "a";
        return { toArray: () => [row] };
      },
    };
    const got = asSql(sql).exec("SELECT ?", 1).toArray();
    expect(calls).toEqual([["SELECT ?", 1]]);
    expect(got).toEqual([{ entry: "a" }]);
    expect(Object.getPrototypeOf(got[0])).toBe(Object.prototype);
  });
});

describe("openSettings", () => {
  it("adds email, sub:email, and sub rows and audits the actor verbatim", async () => {
    let now = 1_000;
    const sql = memorySql();
    const store = openSettings(sql, () => now);
    const actor = "ada' OR '1'='1";
    const member = await store.putUser({ entry: " Bob@Example.com ", role: "member", agents: ["kit"] }, actor);
    expect(member).toEqual({
      ok: true,
      user: { entry: { sub: null, email: "bob@example.com" }, role: "member", agents: [], locked: false },
    });
    now = 2_000;
    const operator = await store.putUser(
      { entry: `${EVE.sub}:Eve@Example.com`, role: "operator", agents: ["Kit", " kit ", "", "ada"] },
      actor,
    );
    expect(operator).toMatchObject({ ok: true, user: { role: "operator", agents: ["ada", "kit"], locked: false } });
    now = 3_000;
    const subOnly = await store.putUser({ entry: ADA, role: "admin" }, actor);
    expect(subOnly).toMatchObject({ ok: true, user: { entry: { sub: ADA, email: null }, role: "admin" } });

    expect(await store.list()).toMatchObject([
      { entry: { email: "bob@example.com" }, role: "member" },
      { entry: { sub: EVE.sub, email: "eve@example.com" }, role: "operator", agents: ["ada", "kit"] },
      { entry: { sub: ADA, email: null }, role: "admin" },
    ]);
    const events = await store.audit();
    expect(events.map((event) => event.action)).toEqual(["user.add", "user.add", "user.add"]);
    expect(events[0]?.who).toBe(actor);
    expect(JSON.parse(events[2]?.detail ?? "{}")).toMatchObject({ entry: "bob@example.com", role: "member" });

    const resolved = await resolveUser({ GANTREE_ADMINS: "ada@example.com" }, store, EVE);
    expect(resolved).toMatchObject({ role: "operator", agents: ["ada", "kit"] });
    if (!resolved) {
      throw new Error("missing user");
    }
    expect(canRunAgent(resolved, "kit")).toBe(true);
    expect(canRunAgent(resolved, "zed")).toBe(false);
  });

  it("updates in place, keeps added_at, and drops agents unless the role is operator", async () => {
    let now = 1_000;
    const sql = memorySql();
    const store = openSettings(sql, () => now);
    await store.putUser({ entry: "eve@example.com", role: "operator", agents: ["kit"] }, ADA);
    now = 2_000;
    const updated = await store.putUser({ entry: "eve@example.com", role: "admin", agents: ["kit"] }, ADA);
    expect(updated).toMatchObject({ ok: true, user: { role: "admin", agents: [] } });
    expect(sql.exec("SELECT added_at, role, agents FROM users").toArray()).toEqual([
      { added_at: 1_000, role: "admin", agents: "[]" },
    ]);
    expect((await store.audit(2)).map((event) => event.action)).toEqual(["user.update", "user.add"]);
  });

  it("rejects bad entry, role, and agents without writing", async () => {
    const store = openSettings(memorySql(), () => 1);
    const cases: Array<[Parameters<typeof store.putUser>[0], string]> = [
      [{ entry: 12, role: "member" }, "bad_entry"],
      [{ entry: "not a person", role: "member" }, "bad_entry"],
      [{ entry: "eve@example.com", role: "root" }, "bad_role"],
      [{ entry: "eve@example.com", role: "operator", agents: "kit" }, "bad_agents"],
      [{ entry: "eve@example.com", role: "operator", agents: ["bad_slug"] }, "bad_agents"],
      [{ entry: "eve@example.com", role: "operator", agents: ["kit", 1] }, "bad_agents"],
      [{ entry: "eve@example.com", role: "operator", agents: Array.from({ length: 65 }, () => "kit") }, "bad_agents"],
    ];
    for (const [input, error] of cases) {
      expect(await store.putUser(input, ADA)).toEqual({ ok: false, error });
    }
    expect(await store.list()).toEqual([]);
    expect(await store.audit()).toEqual([]);
    const emptyAgents = await store.putUser({ entry: "eve@example.com", role: "operator" }, ADA);
    expect(emptyAgents).toMatchObject({ ok: true, user: { agents: [] } });
  });

  it("removes a row, audits it, and misses the next time", async () => {
    const store = openSettings(memorySql(), () => 50);
    await store.putUser({ entry: "eve@example.com", role: "member" }, ADA);
    expect(await store.removeUser("nope", ADA)).toEqual({ ok: false, error: "bad_entry" });
    expect(await store.removeUser("missing@example.com", ADA)).toEqual({ ok: false, error: "not_found" });
    expect(await store.removeUser("Eve@Example.com", ADA)).toEqual({ ok: true });
    expect(await store.list()).toEqual([]);
    expect(await store.removeUser("eve@example.com", ADA)).toEqual({ ok: false, error: "not_found" });
    const events = await store.audit(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "user.remove", who: ADA, at: 50 });
    expect(JSON.parse(events[0]?.detail ?? "{}")).toEqual({ entry: "eve@example.com" });
  });

  it("clamps the audit window", async () => {
    const store = openSettings(memorySql(), () => 1);
    await store.putUser({ entry: "a@example.com", role: "member" }, ADA);
    await store.putUser({ entry: "b@example.com", role: "member" }, ADA);
    await store.putUser({ entry: "c@example.com", role: "member" }, ADA);
    expect((await store.audit(2)).map((event) => (JSON.parse(event.detail) as { entry?: string }).entry)).toEqual(["c@example.com", "b@example.com"]);
    expect(await store.audit(0)).toHaveLength(1);
    expect(await store.audit(10_000)).toHaveLength(3);
    expect(await store.audit(Number.NaN)).toHaveLength(3);
  });

  it("skips corrupt rows and still reads a bigint audit id", async () => {
    const sql: Sql = {
      exec(query) {
        if (query.includes("FROM users")) {
          return {
            toArray: () => [
              { entry: "not an entry", role: "admin", agents: "[]" },
              { entry: "eve@example.com", role: "nope", agents: "[]" },
              { entry: "eve@example.com", role: "member", agents: "{}" },
              { entry: "sam@example.com", role: "member", agents: "{" },
              { entry: "bob@example.com", role: "member", agents: 12 },
            ],
          };
        }
        if (query.includes("FROM audit")) {
          return {
            toArray: () => [
              { id: 2n, at: 9n, who: "ada", action: "user.add", detail: "{}" },
              { id: "x", at: 1, who: 1, action: "user.add", detail: "{}" },
            ],
          };
        }
        if (query.includes("FROM samples")) {
          return {
            toArray: () => [
              { id: 1, at: 1, agent: "kit", kind: "turn", value: 1.5 },
              { id: 2, at: 2, agent: "kit", kind: "turn", value: "nope" },
            ],
          };
        }
        return { toArray: () => [] };
      },
    };
    const store = openSettings(sql, () => 1);
    expect(await store.list()).toEqual([
      { entry: { sub: null, email: "eve@example.com" }, role: "member", agents: [], locked: false },
      { entry: { sub: null, email: "sam@example.com" }, role: "member", agents: [], locked: false },
      { entry: { sub: null, email: "bob@example.com" }, role: "member", agents: [], locked: false },
    ]);
    expect(await store.audit(1)).toEqual([{ id: 2, at: 9, who: "ada", action: "user.add", detail: "{}" }]);
    expect(await store.samples(10)).toEqual([{ id: 1, at: 1, agent: "kit", kind: "turn", value: 1.5 }]);
  });

  it("records samples and rejects junk", async () => {
    const sql = memorySql();
    const store = openSettings(sql, () => 80);
    expect(await store.addSample({ agent: "Kit", kind: "Turn", value: 3.5 })).toEqual({
      ok: true,
      sample: { id: 1, at: 80, agent: "kit", kind: "turn", value: 3.5 },
    });
    await store.addSample({ agent: "ada", kind: "tokens", value: 1 });
    const bad: SampleInput[] = [
      { agent: "1kit", kind: "turn", value: 1 },
      { agent: "kit", kind: " ", value: 1 },
      { agent: "kit", kind: "turn", value: Number.POSITIVE_INFINITY },
      { agent: " ", kind: "turn", value: 1 },
    ];
    for (const input of bad) {
      expect(await store.addSample(input)).toEqual({ ok: false, error: "bad_sample" });
    }
    expect(await store.addSample({ agent: "kit", kind: "turn", value: "1" } as unknown as SampleInput)).toEqual({
      ok: false,
      error: "bad_sample",
    });
    expect((await store.samples(1)).map((row) => row.agent)).toEqual(["ada"]);
    expect(await store.samples(10)).toHaveLength(2);
  });

  it("fails closed when an insert cannot be read back", async () => {
    const replies: Record<string, unknown>[][] = [[], [{}], [{ id: 1 }]];
    for (const reply of replies) {
      const sql: Sql = {
        exec(query) {
          if (query.includes("last_insert_rowid")) {
            return { toArray: () => reply };
          }
          return { toArray: () => [] };
        },
      };
      const store = openSettings(sql, () => 1);
      expect(await store.addSample({ agent: "kit", kind: "turn", value: 1 })).toEqual({ ok: false, error: "bad_sample" });
    }
  });

  it("lists samples by agent, set, and since", async () => {
    let now = 100;
    const store = openSettings(memorySql(), () => now);
    await store.addSample({ agent: "kit", kind: "turn", value: 1 });
    now = 200;
    await store.addSample({ agent: "ada", kind: "tokens_prompt", value: 4 });
    now = 300;
    await store.addSample({ agent: "kit", kind: "tokens_completion", value: 2 });

    expect((await store.listSamples({ agent: "Kit", since: 150 })).map((row) => row.kind)).toEqual(["tokens_completion"]);
    expect((await store.listSamples({ agents: ["ada", "kit"], since: 200 })).map((row) => row.agent)).toEqual(["kit", "ada"]);
    expect(await store.listSamples({ agents: [] })).toEqual([]);
    expect(await store.listSamples({ agent: "kit' OR '1'='1" })).toEqual([]);
    expect(await store.listSamples({ agents: ["1nope"] })).toEqual([]);
    expect(await store.listSamples({ since: 250, limit: 1 })).toEqual([
      { id: 3, at: 300, agent: "kit", kind: "tokens_completion", value: 2 },
    ]);
    expect(await store.listSamples()).toHaveLength(3);
  });
});

describe("platform secrets", () => {
  it("stores, reads, clears, and audits without secret values", async () => {
    const sql = memorySql();
    const store = openSettings(sql);
    expect(await store.platformSecrets()).toEqual({});
    expect(await store.putPlatformSecrets({ GOOGLE_CLIENT_ID: "  id  ", GOOGLE_CLIENT_SECRET: "sec" }, "actor")).toEqual({ ok: true });
    expect(await store.platformSecrets()).toEqual({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "sec" });
    expect(await store.putPlatformSecrets({ GOOGLE_CLIENT_SECRET: null }, "actor")).toEqual({ ok: true });
    expect(await store.platformSecrets()).toEqual({ GOOGLE_CLIENT_ID: "id" });
    expect(await store.putPlatformSecrets({ BAD: "x" }, "actor")).toEqual({ ok: false, error: "bad_key" });
    const events = await store.audit(10);
    const platform = events.filter((event) => event.action === "platform_secret");
    expect(platform.length).toBeGreaterThan(0);
    for (const event of platform) {
      expect(event.detail).not.toContain("sec");
      const detail = JSON.parse(event.detail) as { key?: string; action?: string };
      expect(detail.key).toEqual(expect.any(String));
      expect(detail.action).toMatch(/set|cleared/);
    }
  });
});
