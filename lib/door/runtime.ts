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
import { effectiveGoogle } from "./platform";
import type {
  AuditEvent,
  PutOutcome,
  PutPlatformSecretsOutcome,
  PutUserInput,
  RemoveOutcome,
  UserMutations,
} from "./settingsStore";
import { memoryStore, type UserRow, type UserStore } from "./users";

const SETTINGS_NAME = "settings";

type SettingsId = { toString(): string };

type SettingsStub = {
  listUsers: () => Promise<UserRow[]>;
  putUser: (input: PutUserInput, actor: string) => Promise<PutOutcome>;
  removeUser: (entry: string, actor: string) => Promise<RemoveOutcome>;
  audit: (limit: number) => Promise<AuditEvent[]>;
  platformSecrets?: () => Promise<Record<string, string>>;
  putPlatformSecrets?: (patch: Record<string, string | null>, actor: string) => Promise<PutPlatformSecretsOutcome>;
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

function storeFromStub(stub: SettingsStub | null): UserStore {
  if (!stub) {
    return memoryStore();
  }
  const store: UserStore & UserMutations & {
    platformSecrets?: () => Promise<Record<string, string>>;
    putPlatformSecrets?: (patch: Record<string, string | null>, actor: string) => Promise<PutPlatformSecretsOutcome>;
  } = {
    list: () => stub.listUsers(),
    putUser: (input, actor) => stub.putUser(input, actor),
    removeUser: (entry, actor) => stub.removeUser(entry, actor),
    audit: (limit) => stub.audit(limit ?? 50),
  };
  if (typeof stub.platformSecrets === "function") {
    const platformSecrets = stub.platformSecrets;
    store.platformSecrets = () => platformSecrets();
  }
  if (typeof stub.putPlatformSecrets === "function") {
    const putPlatformSecrets = stub.putPlatformSecrets;
    store.putPlatformSecrets = (patch, actor) => putPlatformSecrets(patch, actor);
  }
  return store;
}

export function userStore(): UserStore {
  return storeFromStub(settingsStub());
}

export async function platformGoogleFor(bindings: DoorEnv): Promise<{ clientId: string; clientSecret: string }> {
  const ns = (bindings as DoorEnv & { SETTINGS?: SettingsNamespace }).SETTINGS;
  let stored: Record<string, string> = {};
  if (ns && typeof ns === "object") {
    let stub: SettingsStub | null = null;
    if (typeof ns.getByName === "function") {
      stub = ns.getByName(SETTINGS_NAME);
    } else if (typeof ns.idFromName === "function" && typeof ns.get === "function") {
      stub = ns.get(ns.idFromName(SETTINGS_NAME));
    }
    if (stub && typeof stub.platformSecrets === "function") {
      stored = await stub.platformSecrets();
    }
  }
  const eff = effectiveGoogle(
    { clientId: bindings.GOOGLE_CLIENT_ID, clientSecret: bindings.GOOGLE_CLIENT_SECRET },
    { clientId: stored.GOOGLE_CLIENT_ID, clientSecret: stored.GOOGLE_CLIENT_SECRET },
  );
  return { clientId: eff.clientId, clientSecret: eff.clientSecret };
}

export function platformGoogle(): Promise<{ clientId: string; clientSecret: string }> {
  return platformGoogleFor(env);
}
