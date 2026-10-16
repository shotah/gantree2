import { describe, expect, it } from "vitest";
import { canRunAgent, envUsers, hasAdmins, memoryStore, resolveUser } from "@/lib/door/users";

const ADA = { sub: "118212345678901234567", email: "ada@example.com", emailVerified: true };
const BOB = { sub: "228212345678901234567", email: "bob@example.com", emailVerified: true };
const EVE = { sub: "338212345678901234567", email: "eve@example.com", emailVerified: true };

describe("envUsers", () => {
  it("admins first, members after, both locked, admin wins a duplicate", () => {
    const rows = envUsers({ GANTREE_ADMINS: "ada@example.com", GANTREE_ALLOW: "bob@example.com, ada@example.com" });
    expect(rows.map((r) => [r.entry.email, r.role, r.locked])).toEqual([
      ["ada@example.com", "admin", true],
      ["bob@example.com", "member", true],
    ]);
  });

  it("hasAdmins fails closed on empty or junk", () => {
    expect(hasAdmins({})).toBe(false);
    expect(hasAdmins({ GANTREE_ADMINS: "junk" })).toBe(false);
    expect(hasAdmins({ GANTREE_ADMINS: "ada@example.com" })).toBe(true);
  });
});

describe("resolveUser", () => {
  const env = { GANTREE_ADMINS: "ada@example.com", GANTREE_ALLOW: "bob@example.com" };

  it("env floor: admin, member, stranger", async () => {
    const store = memoryStore();
    expect(await resolveUser(env, store, ADA)).toMatchObject({ role: "admin", agents: [] });
    expect(await resolveUser(env, store, BOB)).toMatchObject({ role: "member" });
    expect(await resolveUser(env, store, EVE)).toBeNull();
  });

  it("store rows add people and agents; highest role wins; operator agents union", async () => {
    const store = memoryStore([
      { entry: { sub: null, email: "eve@example.com" }, role: "operator", agents: ["kit"], locked: false },
      { entry: { sub: EVE.sub, email: null }, role: "operator", agents: ["ada"], locked: false },
      { entry: { sub: null, email: "bob@example.com" }, role: "operator", agents: ["kit"], locked: false },
    ]);
    const eve = await resolveUser(env, store, EVE);
    expect(eve).toMatchObject({ role: "operator", agents: ["ada", "kit"] });
    if (!eve) {
      return;
    }
    expect(canRunAgent(eve, "kit")).toBe(true);
    expect(canRunAgent(eve, "zed")).toBe(false);
    const bob = await resolveUser(env, store, BOB);
    expect(bob).toMatchObject({ role: "operator", agents: ["kit"] });
    const ada = await resolveUser(env, store, ADA);
    expect(ada?.role).toBe("admin");
    if (!ada) {
      return;
    }
    expect(canRunAgent(ada, "anything")).toBe(true);
  });

  it("keeps stored admin chat agents even when the env floor row has none", async () => {
    const store = memoryStore([
      { entry: { sub: null, email: "ada@example.com" }, role: "admin", agents: ["tim"], locked: false },
    ]);
    const ada = await resolveUser(env, store, ADA);
    expect(ada).toEqual({
      role: "admin",
      agents: ["tim"],
      entry: { sub: null, email: "ada@example.com" },
    });
    if (!ada) {
      return;
    }
    expect(canRunAgent(ada, "zed")).toBe(true);
  });

  it("a removed store row is a miss on the next resolve", async () => {
    const rows = [{ entry: { sub: null, email: "eve@example.com" }, role: "member" as const, agents: [], locked: false }];
    const store = memoryStore(rows);
    expect(await resolveUser(env, store, EVE)).not.toBeNull();
    rows.length = 0;
    expect(await resolveUser(env, store, EVE)).toBeNull();
  });
});
