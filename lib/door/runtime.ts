/**
 * Worker-side wiring: bindings in, store out. The only door file that touches
 * `cloudflare:workers`, so everything else stays testable in plain Vitest.
 *
 * Stored users live on the Settings Durable Object (`SETTINGS.getByName("settings")`,
 * or `get(idFromName("settings"))` when `getByName` is absent). Without that
 * binding the store is empty and `GANTREE_ADMINS` / `GANTREE_ALLOW` are the whole list.
 */
import { env } from "cloudflare:workers";
import type { DoorEnv } from "./http";
import type { AuditEvent, PutOutcome, PutUserInput, RemoveOutcome, UserMutations } from "./settingsStore";
import { memoryStore, type UserRow, type UserStore } from "./users";

const SETTINGS_NAME = "settings";

type SettingsId = { toString(): string };

type SettingsStub = {
  listUsers: () => Promise<UserRow[]>;
  putUser: (input: PutUserInput, actor: string) => Promise<PutOutcome>;
  removeUser: (entry: string, actor: string) => Promise<RemoveOutcome>;
  audit: (limit: number) => Promise<AuditEvent[]>;
};

type SettingsNamespace = {
  getByName?: (name: string) => SettingsStub;
  idFromName?: (name: string) => SettingsId;
  get?: (id: SettingsId) => SettingsStub;
};

function settingsNamespace(): SettingsNamespace | null {
  const bindings = env as unknown as { SETTINGS?: SettingsNamespace };
  const ns = bindings.SETTINGS;
  if (!ns || typeof ns !== "object") {
    return null;
  }
  return ns;
}

function settingsStub(): SettingsStub | null {
  const ns = settingsNamespace();
  if (!ns) {
    return null;
  }
  if (typeof ns.getByName === "function") {
    return ns.getByName(SETTINGS_NAME);
  }
  if (typeof ns.idFromName === "function" && typeof ns.get === "function") {
    return ns.get(ns.idFromName(SETTINGS_NAME));
  }
  return null;
}

export function doorEnv(): DoorEnv {
  return env;
}

export function userStore(): UserStore {
  const stub = settingsStub();
  if (!stub) {
    return memoryStore();
  }
  const store: UserStore & UserMutations = {
    list: () => stub.listUsers(),
    putUser: (input, actor) => stub.putUser(input, actor),
    removeUser: (entry, actor) => stub.removeUser(entry, actor),
    audit: (limit) => stub.audit(limit ?? 50),
  };
  return store;
}
