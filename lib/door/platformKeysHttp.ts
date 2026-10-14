/**
 * `/api/platform/keys` — admin view of the platform Google OAuth client.
 * Never returns the secret; PATCH stores overrides on the Settings DO.
 */
import { effectiveGoogle } from "./platform";
import { guard, json, me, type DoorEnv } from "./http";
import type { PutPlatformSecretsOutcome } from "./settingsStore";
import type { UserStore } from "./users";

const STATUS: Record<string, number> = {
  bad_json: 400,
  bad_key: 400,
  bad_value: 400,
  forbidden: 403,
  settings_unavailable: 503,
};

function fail(error: keyof typeof STATUS): Response {
  return json({ error }, STATUS[error]);
}

type PlatformKeysBody = {
  google: {
    clientId: string;
    secretSet: boolean;
    idFromDeploy: boolean;
    secretFromDeploy: boolean;
  };
};

type PlatformSecretStore = {
  platformSecrets: () => Promise<Record<string, string>>;
  putPlatformSecrets: (patch: Record<string, string | null>, actor: string) => Promise<PutPlatformSecretsOutcome>;
};

function platformSecretsStore(store: UserStore): PlatformSecretStore | null {
  const candidate = store as Partial<PlatformSecretStore>;
  if (typeof candidate.platformSecrets === "function" && typeof candidate.putPlatformSecrets === "function") {
    return candidate as PlatformSecretStore;
  }
  return null;
}

async function requireAdmin(req: Request, env: DoorEnv, store: UserStore): Promise<{ sub: string } | Response> {
  const blocked = await guard(req, env, store);
  if (blocked) {
    return blocked;
  }
  const profile = await me(req, env, store);
  if (!profile.ok) {
    return profile;
  }
  const body = await profile.json<{ sub?: unknown; role?: unknown }>();
  if (body.role !== "admin" || typeof body.sub !== "string" || body.sub.length === 0) {
    return fail("forbidden");
  }
  return { sub: body.sub };
}

function isResponse(value: { sub: string } | Response): value is Response {
  return value instanceof Response;
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await req.json<unknown>();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function viewBody(env: DoorEnv, stored: Record<string, string>): PlatformKeysBody {
  const eff = effectiveGoogle(
    { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
    { clientId: stored.GOOGLE_CLIENT_ID, clientSecret: stored.GOOGLE_CLIENT_SECRET },
  );
  return {
    google: {
      clientId: eff.clientId,
      secretSet: eff.clientSecret.length > 0,
      idFromDeploy: eff.idFromDeploy,
      secretFromDeploy: eff.secretFromDeploy,
    },
  };
}

export async function getPlatformKeys(req: Request, env: DoorEnv, store: UserStore): Promise<Response> {
  const admin = await requireAdmin(req, env, store);
  if (isResponse(admin)) {
    return admin;
  }
  const api = platformSecretsStore(store);
  const stored = api ? await api.platformSecrets() : {};
  return json(viewBody(env, stored));
}

export async function patchPlatformKeys(req: Request, env: DoorEnv, store: UserStore): Promise<Response> {
  const admin = await requireAdmin(req, env, store);
  if (isResponse(admin)) {
    return admin;
  }
  const api = platformSecretsStore(store);
  if (!api) {
    return fail("settings_unavailable");
  }
  const body = await readJson(req);
  if (!body) {
    return fail("bad_json");
  }
  const patch: Record<string, string | null> = {};
  if (Object.prototype.hasOwnProperty.call(body, "clientId")) {
    const raw = body.clientId;
    if (raw !== null && typeof raw !== "string") {
      return fail("bad_value");
    }
    patch.GOOGLE_CLIENT_ID = raw === null || raw === "" ? null : raw;
  }
  if (Object.prototype.hasOwnProperty.call(body, "clientSecret")) {
    const raw = body.clientSecret;
    if (raw !== null && typeof raw !== "string") {
      return fail("bad_value");
    }
    patch.GOOGLE_CLIENT_SECRET = raw === null || raw === "" ? null : raw;
  }
  if (Object.keys(patch).length === 0) {
    const stored = await api.platformSecrets();
    return json(viewBody(env, stored));
  }
  const outcome = await api.putPlatformSecrets(patch, admin.sub);
  if (!outcome.ok) {
    return fail(outcome.error);
  }
  const stored = await api.platformSecrets();
  return json(viewBody(env, stored));
}
