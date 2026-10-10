import { describe, expect, it } from "vitest";
import { gate } from "@/lib/door/gate";
import { sealSession, SESSION_COOKIE, sessionKey } from "@/lib/door/session";
import { openSettings, type PutOutcome, type PutUserInput } from "@/lib/door/settingsStore";
import { memoryStore, type Role, type UserRow } from "@/lib/door/users";
import { deleteUser, getUsers, mergeUsers, postUser } from "@/lib/door/usersHttp";
import { memorySql } from "./memorySql";

const SECRET = "0123456789abcdef0123456789abcdef-more";
const ADA_SUB = "118212345678901234567";
const BOB_SUB = "228212345678901234567";
const EVE_SUB = "338212345678901234567";

const env = {
  SESSION_SECRET: SECRET,
  GANTREE_ADMINS: "ada@example.com",
  GANTREE_ALLOW: "bob@example.com",
};

async function sessionReq(path: string, sub: string, email: string | null, method = "GET", body?: string) {
  const token = await sealSession(await sessionKey(SECRET), { sub, email });
  return new Request(`https://g.test${path}`, {
    method,
    headers: {
      cookie: `${SESSION_COOKIE}=${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body,
  });
}

function ada(path: string, method = "GET", body?: string) {
  return sessionReq(path, ADA_SUB, "ada@example.com", method, body);
}

class Recording {
  rows: UserRow[] = [];
  events: { id: number; at: number; who: string; action: string; detail: string }[] = [];
  puts: { input: PutUserInput; actor: string }[] = [];
  removes: { entry: string; actor: string }[] = [];
  auditLimit: number | undefined;
  fail: PutOutcome | null = null;

  async list() {
    return this.rows;
  }

  async putUser(input: PutUserInput, actor: string): Promise<PutOutcome> {
    this.puts.push({ input, actor });
    if (this.fail) {
      return this.fail;
    }
    const user: UserRow = {
      entry: { sub: null, email: String(input.entry) },
      role: input.role as Role,
      agents: [],
      locked: false,
    };
    return { ok: true, user };
  }

  async removeUser(entry: string, actor: string) {
    this.removes.push({ entry, actor });
    return { ok: false as const, error: "not_found" as const };
  }

  async audit(limit?: number) {
    this.auditLimit = limit;
    return this.events;
  }
}

describe("mergeUsers", () => {
  it("keeps env rows locked and drops a stored duplicate", () => {
    const merged = mergeUsers(
      { GANTREE_ADMINS: "ada@example.com", GANTREE_ALLOW: "bob@example.com" },
      [
        { entry: { sub: null, email: "ada@example.com" }, role: "member", agents: ["kit"], locked: false },
        { entry: { sub: null, email: "eve@example.com" }, role: "operator", agents: ["kit"], locked: false },
        { entry: { sub: null, email: null }, role: "member", agents: [], locked: false },
      ],
    );
    expect(merged.map((row) => [row.entry.email ?? row.entry.sub, row.role, row.locked])).toEqual([
      ["ada@example.com", "admin", true],
      ["bob@example.com", "member", true],
      ["eve@example.com", "operator", false],
    ]);
  });
});

describe("getUsers", () => {
  it("401 without a session, 503 with no admins, 403 for member and operator", async () => {
    const store = new Recording();
    expect((await getUsers(new Request("https://g.test/api/users"), env, store)).status).toBe(401);
    expect((await getUsers(await ada("/api/users"), { SESSION_SECRET: SECRET }, store)).status).toBe(503);
    expect((await getUsers(await sessionReq("/api/users", BOB_SUB, "bob@example.com"), env, store)).status).toBe(403);
    store.rows = [{ entry: { sub: EVE_SUB, email: "eve@example.com" }, role: "operator", agents: ["kit"], locked: false }];
    expect((await getUsers(await sessionReq("/api/users", EVE_SUB, "eve@example.com"), env, store)).status).toBe(403);
  });

  it("returns the floor, stored rows, and audit for an admin", async () => {
    const store = new Recording();
    store.rows = [
      { entry: { sub: null, email: "ada@example.com" }, role: "member", agents: [], locked: false },
      { entry: { sub: null, email: "eve@example.com" }, role: "operator", agents: ["kit"], locked: false },
    ];
    store.events = [{ id: 1, at: 5, who: ADA_SUB, action: "user.add", detail: "{\"entry\":\"eve@example.com\"}" }];
    const res = await getUsers(await ada("/api/users"), env, store);
    expect(res.status).toBe(200);
    const body = await res.json<{ users: UserRow[]; audit: { id: number }[] }>();
    expect(body.users.map((row) => [row.entry.email, row.role, row.locked])).toEqual([
      ["ada@example.com", "admin", true],
      ["bob@example.com", "member", true],
      ["eve@example.com", "operator", false],
    ]);
    expect(body.audit).toEqual(store.events);
    expect(store.auditLimit).toBe(50);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("401s when the row disappears between the gate and the profile read", async () => {
    let calls = 0;
    const fading = {
      async list() {
        calls += 1;
        if (calls > 1) {
          return [];
        }
        return [{ entry: { sub: null, email: "eve@example.com" }, role: "admin" as const, agents: [], locked: false }];
      },
    };
    const res = await getUsers(await sessionReq("/api/users", EVE_SUB, "eve@example.com"), env, fading);
    expect(res.status).toBe(401);
  });

  it("honors a loopback dev admin and still lists env rows without the DO", async () => {
    const dev = { ...env, GANTREE_DEV_USER: `${ADA_SUB}:ada@example.com` };
    const ok = await getUsers(new Request("http://127.0.0.1/api/users"), dev, memoryStore());
    expect(ok.status).toBe(200);
    const body = await ok.json<{ users: UserRow[]; audit: unknown[] }>();
    expect(body.users.map((row) => row.entry.email)).toEqual(["ada@example.com", "bob@example.com"]);
    expect(body.audit).toEqual([]);
    expect((await getUsers(new Request("https://g.test/api/users"), dev, memoryStore())).status).toBe(401);
  });
});

describe("postUser", () => {
  it("rejects non-admins, bad JSON, bad entries, and locked env rows", async () => {
    const store = new Recording();
    const member = await postUser(
      await sessionReq("/api/users", BOB_SUB, "bob@example.com", "POST", JSON.stringify({ entry: "eve@example.com", role: "member" })),
      env,
      store,
    );
    expect(member.status).toBe(403);
    expect(store.puts).toEqual([]);

    const missing = await postUser(await ada("/api/users", "POST", JSON.stringify({ entry: "eve@example.com", role: "member" })), env, memoryStore());
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ error: "settings_unavailable" });

    const junk = ["nope", "[]", JSON.stringify(["x"]), JSON.stringify({ role: "member" }), JSON.stringify({ entry: 4, role: "member" })];
    const codes = ["bad_json", "bad_json", "bad_json", "bad_entry", "bad_entry"];
    for (let i = 0; i < junk.length; i += 1) {
      const res = await postUser(await ada("/api/users", "POST", junk[i]), env, store);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: codes[i] });
    }
    const unparsed = await postUser(
      await ada("/api/users", "POST", JSON.stringify({ entry: "not a person", role: "member" })),
      env,
      store,
    );
    expect(unparsed.status).toBe(400);
    expect(await unparsed.json()).toEqual({ error: "bad_entry" });
    const locked = await postUser(
      await ada("/api/users", "POST", JSON.stringify({ entry: " Ada@Example.com ", role: "member" })),
      env,
      store,
    );
    expect(locked.status).toBe(409);
    expect(await locked.json()).toEqual({ error: "locked" });
    expect(store.puts).toEqual([]);
  });

  it("stores a canonical entry and the admin's sub", async () => {
    const sql = memorySql();
    const store = openSettings(sql, () => 10);
    const res = await postUser(
      await ada("/api/users", "POST", JSON.stringify({ entry: " Eve@Example.com ", role: "operator", agents: ["Kit", "kit", "ada"] })),
      env,
      store,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: {
        entry: { sub: null, email: "eve@example.com" },
        role: "operator",
        agents: ["ada", "kit"],
        locked: false,
      },
    });
    expect(await store.audit(1)).toMatchObject([{ who: ADA_SUB, action: "user.add" }]);

    const badRole = await postUser(
      await ada("/api/users", "POST", JSON.stringify({ entry: "sam@example.com", role: "root" })),
      env,
      store,
    );
    expect(badRole.status).toBe(400);
    expect(await badRole.json()).toEqual({ error: "bad_role" });
    const badAgents = await postUser(
      await ada("/api/users", "POST", JSON.stringify({ entry: "sam@example.com", role: "operator", agents: ["bad slug"] })),
      env,
      store,
    );
    expect(badAgents.status).toBe(400);
    expect(await badAgents.json()).toEqual({ error: "bad_agents" });
  });
});

describe("deleteUser", () => {
  it("409 for env rows, 404 when missing, 400 for junk, 503 without storage", async () => {
    const store = openSettings(memorySql(), () => 1);
    expect((await deleteUser(new Request("https://g.test/api/users/ada@example.com", { method: "DELETE" }), env, store, "ada@example.com")).status).toBe(401);
    expect((await deleteUser(await ada("/api/users/ada@example.com", "DELETE"), env, store, "ada@example.com")).status).toBe(409);
    expect((await deleteUser(await ada("/api/users/missing", "DELETE"), env, store, "missing@example.com")).status).toBe(404);
    expect((await deleteUser(await ada("/api/users/junk", "DELETE"), env, store, "not an entry")).status).toBe(400);
    const unavailable = await deleteUser(await ada("/api/users/eve@example.com", "DELETE"), env, memoryStore(), "eve@example.com");
    expect(unavailable.status).toBe(503);
    const recording = new Recording();
    const gone = await deleteUser(await ada("/api/users/eve@example.com", "DELETE"), env, recording, "Eve@Example.com");
    expect(gone.status).toBe(404);
    expect(recording.removes).toEqual([{ entry: "eve@example.com", actor: ADA_SUB }]);
  });
});

describe("add then yank", () => {
  it("lets Bob in, then the next request is 401", async () => {
    const store = openSettings(memorySql(), () => 1);
    const added = await postUser(
      await ada("/api/users", "POST", JSON.stringify({ entry: "bob-guest@example.com", role: "member" })),
      { SESSION_SECRET: SECRET, GANTREE_ADMINS: "ada@example.com" },
      store,
    );
    expect(added.status).toBe(200);

    const bobEnv = { SESSION_SECRET: SECRET, GANTREE_ADMINS: "ada@example.com" };
    const bob = () => sessionReq("/agents/kit", BOB_SUB, "bob-guest@example.com");
    expect(await gate(await bob(), bobEnv, store)).toMatchObject({ kind: "pass", who: { role: "member" } });

    const removed = await deleteUser(
      await ada("/api/users/bob-guest@example.com", "DELETE"),
      bobEnv,
      store,
      "bob-guest@example.com",
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });
    expect(await gate(await bob(), bobEnv, store)).toMatchObject({ kind: "unauthorized", status: 401 });
    expect((await getUsers(await bob(), bobEnv, store)).status).toBe(401);
  });
});
