import { generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "@/app/lib/release";
import { readChatSession } from "@/lib/chat/session";
import { authConfig, authNonce, authToken } from "@/lib/door/native";
import { openNonce, openSession, sealNonce, SESSION_TTL_S, sessionKey } from "@/lib/door/session";
import { memoryStore } from "@/lib/door/users";

const SECRET = "0123456789abcdef0123456789abcdef-more";
const OTHER = "another-secret-that-is-long-enough-xx";
const CLIENT = "123-abc.apps.googleusercontent.com";
const env = { SESSION_SECRET: SECRET, GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: "sec", GANTREE_ADMINS: "ada@example.com" };
const ADA_SUB = "118212345678901234567";
const EVE_SUB = "999999999999999999999";
const TOKEN_URL = "https://g.test/api/auth/token";

function post(body: string): Request {
  return new Request(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

async function idTokenFor(claims: Record<string, unknown>, now: number) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const iat = Math.floor(now / 1000);
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer("https://accounts.google.com")
    .setAudience(CLIENT)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 300)
    .sign(privateKey);
  return { token, publicKey };
}

describe("authConfig", () => {
  it("is google when the client id and session secret are set, spike otherwise", async () => {
    const res = authConfig(new Request("https://g.test/api/auth/config"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      mode: "google",
      google: true,
      voice: false,
      version: PACKAGE_VERSION,
      dev: false,
    });
    expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    const noClient = authConfig(new Request("https://g.test/api/auth/config"), { SESSION_SECRET: SECRET });
    expect(await noClient.json()).toMatchObject({ mode: "spike", google: false, voice: false, version: PACKAGE_VERSION });
    const noSecret = authConfig(new Request("https://g.test/api/auth/config"), { GOOGLE_CLIENT_ID: CLIENT });
    expect(await noSecret.json()).toMatchObject({ mode: "spike", google: false });
  });

  it("voice is true only when /api/chat/tts can synthesize", async () => {
    const on = authConfig(new Request("https://g.test/api/auth/config"), { ...env, GOOGLE_TTS_API_KEY: "k" });
    expect(await on.json()).toMatchObject({ voice: true });
    const off = authConfig(new Request("https://g.test/api/auth/config"), { ...env, GOOGLE_TTS_API_KEY: "k", VOICE: "off" });
    expect(await off.json()).toMatchObject({ voice: false });
    const flagOnly = authConfig(new Request("https://g.test/api/auth/config"), { ...env, VOICE: "on" });
    expect(await flagOnly.json()).toMatchObject({ voice: false });
  });

  it("dev follows loopback", async () => {
    const loop = authConfig(new Request("http://127.0.0.1:3000/api/auth/config"), env);
    expect(await loop.json()).toMatchObject({ dev: true, version: PACKAGE_VERSION });
    const host = authConfig(new Request("http://localhost:3000/api/auth/config"), env);
    expect(await host.json()).toMatchObject({ dev: true });
    const pub = authConfig(new Request("https://g.test/api/auth/config"), env);
    expect(await pub.json()).toMatchObject({ dev: false });
  });
});

describe("authNonce", () => {
  it("returns a JWE under 255 characters that opens with the session key", async () => {
    const res = await authNonce(env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json<{ nonce: string }>();
    expect(body).toEqual({ nonce: body.nonce });
    expect(body.nonce.length).toBeGreaterThan(0);
    expect(body.nonce.length).toBeLessThan(255);
    const claims = await openNonce(await sessionKey(SECRET), body.nonce);
    if (!claims) {
      throw new Error("nonce did not open");
    }
    expect(claims.n.length).toBeGreaterThan(0);
  });

  it("503 when SESSION_SECRET is missing", async () => {
    const res = await authNonce({ GOOGLE_CLIENT_ID: CLIENT });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not_configured" });
  });
});

describe("authToken", () => {
  it("400 when the body is not usable, even if secrets are missing", async () => {
    const bodies = [
      "nope",
      "{}",
      JSON.stringify({ id_token: "x" }),
      JSON.stringify({ nonce: "y" }),
      JSON.stringify({ id_token: "", nonce: "y" }),
      JSON.stringify({ id_token: "x", nonce: "" }),
      JSON.stringify({ id_token: 1, nonce: "y" }),
      JSON.stringify({ id_token: "x", nonce: 1 }),
      "null",
      "[]",
    ];
    for (const body of bodies) {
      const res = await authToken(post(body), env, memoryStore());
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    }
    const unconfigured = await authToken(post("{}"), {}, memoryStore());
    expect(unconfigured.status).toBe(400);
  });

  it("503 when the client id or session secret is missing", async () => {
    const body = JSON.stringify({ id_token: "x", nonce: "y" });
    const noClient = await authToken(post(body), { SESSION_SECRET: SECRET }, memoryStore());
    expect(noClient.status).toBe(503);
    expect(await noClient.json()).toEqual({ error: "not_configured" });
    const noSecret = await authToken(post(body), { GOOGLE_CLIENT_ID: CLIENT }, memoryStore());
    expect(noSecret.status).toBe(503);
    expect(await noSecret.json()).toEqual({ error: "not_configured" });
  });

  it("401 nonce when the nonce is not ours", async () => {
    const now = Date.now();
    const foreign = await sealNonce(await sessionKey(OTHER), now);
    const ours = await sealNonce(await sessionKey(SECRET), now);
    const expired = await sealNonce(await sessionKey(SECRET), now - (10 * 60 + 5) * 1000);
    const cases = [foreign, `${ours}x`, expired, "y"];
    for (const nonce of cases) {
      const res = await authToken(post(JSON.stringify({ id_token: "x", nonce })), env, memoryStore(), { now });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "nonce" });
    }
  });

  it("401 token when the ID token does not match the posted nonce", async () => {
    const now = Date.now();
    const nonce = await sealNonce(await sessionKey(SECRET), now);
    const mismatch = await idTokenFor({ sub: ADA_SUB, email: "ada@example.com", email_verified: true, nonce: "other" }, now);
    const wrongNonce = await authToken(
      post(JSON.stringify({ id_token: mismatch.token, nonce })),
      env,
      memoryStore(),
      { key: mismatch.publicKey, now },
    );
    expect(wrongNonce.status).toBe(401);
    expect(await wrongNonce.json()).toEqual({ error: "token" });

    const { publicKey } = await generateKeyPair("RS256");
    const garbage = await authToken(
      post(JSON.stringify({ id_token: "not-a-jwt", nonce })),
      env,
      memoryStore(),
      { key: publicKey, now },
    );
    expect(garbage.status).toBe(401);
    expect(await garbage.json()).toEqual({ error: "token" });
  });

  it("200 for a listed user: session JWE the socket accepts, exp in epoch seconds, no cookie", async () => {
    const now = Date.now();
    const nonce = await sealNonce(await sessionKey(SECRET), now);
    const { token, publicKey } = await idTokenFor(
      { sub: ADA_SUB, email: "ada@example.com", email_verified: true, nonce },
      now,
    );
    const req = new Request(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "gantree_session=nope" },
      body: JSON.stringify({ id_token: token, nonce }),
    });
    const res = await authToken(req, env, memoryStore(), { key: publicKey, now });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = await res.json<{ token: string; sub: string; email: string | null; exp: number }>();
    expect(body).toEqual({
      token: body.token,
      sub: ADA_SUB,
      email: "ada@example.com",
      exp: Math.floor(now / 1000) + SESSION_TTL_S,
    });
    expect(await openSession(await sessionKey(SECRET), body.token, now)).toEqual({ sub: ADA_SUB, email: "ada@example.com" });
    const chat = await readChatSession(SECRET, { authorization: `Bearer ${body.token}` }, now);
    expect(chat).toMatchObject({ sub: ADA_SUB, email: "ada@example.com", emailVerified: true, exp: body.exp * 1000 });
  });

  it("403 for a stranger, with their own sub and email and no token", async () => {
    const now = Date.now();
    const nonce = await sealNonce(await sessionKey(SECRET), now);
    const { token, publicKey } = await idTokenFor(
      { sub: EVE_SUB, email: "eve@example.com", email_verified: true, nonce },
      now,
    );
    const res = await authToken(
      post(JSON.stringify({ id_token: token, nonce })),
      env,
      memoryStore(),
      { key: publicKey, now },
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_allowed", sub: EVE_SUB, email: "eve@example.com" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
