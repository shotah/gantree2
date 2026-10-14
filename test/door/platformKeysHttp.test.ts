import { describe, expect, it } from "vitest";
import { sealSession, SESSION_COOKIE, sessionKey } from "@/lib/door/session";
import { openSettings } from "@/lib/door/settingsStore";
import { getPlatformKeys, patchPlatformKeys } from "@/lib/door/platformKeysHttp";
import { memorySql } from "./memorySql";

const SECRET = "0123456789abcdef0123456789abcdef-more";
const ADA_SUB = "118212345678901234567";
const EVE_SUB = "338212345678901234567";
const DEPLOY_ID = "deploy.apps.googleusercontent.com";
const DEPLOY_SECRET = "deploy-secret";
const env = {
  SESSION_SECRET: SECRET,
  GOOGLE_CLIENT_ID: DEPLOY_ID,
  GOOGLE_CLIENT_SECRET: DEPLOY_SECRET,
  GANTREE_ADMINS: "ada@example.com",
};

async function sessionReq(path: string, sub: string, email: string, method = "GET", body?: string) {
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

describe("/api/platform/keys", () => {
  it("returns effective id and never the secret", async () => {
    const store = openSettings(memorySql());
    await store.putPlatformSecrets(
      { GOOGLE_CLIENT_ID: "stored-id", GOOGLE_CLIENT_SECRET: "stored-sec" },
      ADA_SUB,
    );
    const res = await getPlatformKeys(await ada("/api/platform/keys"), env, store);
    expect(res.status).toBe(200);
    const body: Record<string, unknown> = await res.json();
    expect(body).toEqual({
      google: {
        clientId: "stored-id",
        secretSet: true,
        idFromDeploy: false,
        secretFromDeploy: false,
      },
    });
    expect(JSON.stringify(body)).not.toContain("stored-sec");
  });

  it("falls through to deploy when stored override is cleared", async () => {
    const store = openSettings(memorySql());
    await store.putPlatformSecrets({ GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "y" }, ADA_SUB);
    await store.putPlatformSecrets({ GOOGLE_CLIENT_ID: null, GOOGLE_CLIENT_SECRET: null }, ADA_SUB);
    const res = await getPlatformKeys(await ada("/api/platform/keys"), env, store);
    const body = await res.json<{ google: { clientId: string; idFromDeploy: boolean; secretFromDeploy: boolean } }>();
    expect(body.google.clientId).toBe(DEPLOY_ID);
    expect(body.google.idFromDeploy).toBe(true);
    expect(body.google.secretFromDeploy).toBe(true);
  });

  it("rejects non-admin patch", async () => {
    const store = openSettings(memorySql());
    await store.putUser({ entry: "eve@example.com", role: "member" }, ADA_SUB);
    const res = await patchPlatformKeys(
      await sessionReq("/api/platform/keys", EVE_SUB, "eve@example.com", "PATCH", JSON.stringify({ clientId: "nope" })),
      env,
      store,
    );
    expect(res.status).toBe(403);
  });
});
