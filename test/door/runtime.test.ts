import { beforeEach, describe, expect, it, vi } from "vitest";

type Stub = {
  listUsers: ReturnType<typeof vi.fn>;
  putUser: ReturnType<typeof vi.fn>;
  removeUser: ReturnType<typeof vi.fn>;
  audit: ReturnType<typeof vi.fn>;
};

/** Shape of the `SETTINGS` binding as `userStore` probes it: partial on purpose, each case binds what it tests. */
type FakeNamespace = Partial<{
  getByName: ReturnType<typeof vi.fn>;
  idFromName: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}>;

const mocks = vi.hoisted(() => {
  const env: { SETTINGS?: FakeNamespace } = {};
  return { env };
});

vi.mock("cloudflare:workers", () => ({
  env: mocks.env,
}));

import { doorEnv, userStore } from "@/lib/door/runtime";
import { hasUserMutations } from "@/lib/door/settingsStore";

function stub(): Stub {
  return {
    listUsers: vi.fn(async () => [{ entry: { sub: null, email: "eve@example.com" }, role: "member" as const, agents: [], locked: false }]),
    putUser: vi.fn(async () => ({ ok: true as const, user: { entry: { sub: null, email: "eve@example.com" }, role: "member" as const, agents: [], locked: false } })),
    removeUser: vi.fn(async () => ({ ok: true as const })),
    audit: vi.fn(async () => []),
  };
}

describe("userStore", () => {
  beforeEach(() => {
    delete mocks.env.SETTINGS;
  });

  it("is an empty memory store until SETTINGS is bound", async () => {
    expect(doorEnv()).toBe(mocks.env);
    expect(hasUserMutations(userStore())).toBe(false);
    expect(await userStore().list()).toEqual([]);
    mocks.env.SETTINGS = {};
    expect(hasUserMutations(userStore())).toBe(false);
  });

  it("prefers getByName(\"settings\") and forwards writes", async () => {
    const idFromName = vi.fn(() => ({ toString: () => "id" }));
    const bound = stub();
    const getByName = vi.fn(() => bound);
    mocks.env.SETTINGS = { getByName, idFromName, get: vi.fn() };
    const store = userStore();
    expect(hasUserMutations(store)).toBe(true);
    expect(getByName).toHaveBeenCalledWith("settings");
    expect(idFromName).not.toHaveBeenCalled();
    expect(await store.list()).toMatchObject([{ entry: { email: "eve@example.com" } }]);
    if (!hasUserMutations(store)) {
      throw new Error("expected mutations");
    }
    await store.putUser({ entry: "eve@example.com", role: "member" }, "ada");
    await store.removeUser("eve@example.com", "ada");
    await store.audit();
    await store.audit(3);
    expect(bound.putUser).toHaveBeenCalledWith({ entry: "eve@example.com", role: "member" }, "ada");
    expect(bound.removeUser).toHaveBeenCalledWith("eve@example.com", "ada");
    expect(bound.audit).toHaveBeenNthCalledWith(1, 50);
    expect(bound.audit).toHaveBeenNthCalledWith(2, 3);
  });

  it("falls back to idFromName when getByName is missing", async () => {
    const id = { toString: () => "settings-id" };
    const bound = stub();
    const get = vi.fn(() => bound);
    const idFromName = vi.fn(() => id);
    mocks.env.SETTINGS = { idFromName, get };
    const store = userStore();
    expect(hasUserMutations(store)).toBe(true);
    expect(idFromName).toHaveBeenCalledWith("settings");
    expect(get).toHaveBeenCalledWith(id);
    expect(await store.list()).toHaveLength(1);
  });
});
