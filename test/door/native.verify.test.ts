import { EncryptJWT, generateKeyPair, jwtDecrypt, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { readChatSession } from "@/lib/chat/session";
import { gate } from "@/lib/door/gate";
import { me } from "@/lib/door/http";
import { b64url } from "@/lib/door/google";
import { authNonce, authToken } from "@/lib/door/native";
import {
  NONCE_TTL_S,
  openNonce,
  openSession,
  sealNonce,
  sealOAuth,
  sealSession,
  SESSION_COOKIE,
  SESSION_TTL_S,
  sessionKey,
} from "@/lib/door/session";
import { memoryStore } from "@/lib/door/users";

const SECRET = "0123456789abcdef0123456789abcdef-more";
const OTHER = "another-secret-that-is-long-enough-xx";
const CLIENT = "123-abc.apps.googleusercontent.com";
const env = {
  SESSION_SECRET: SECRET,
  GOOGLE_CLIENT_ID: CLIENT,
  GOOGLE_CLIENT_SECRET: "sec",
  GANTREE_ADMINS: "ada@example.com",
};
const ADA_SUB = "118212345678901234567";
const EMAIL_SUB = "118200000000000000001";
const EVE_SUB = "999999999999999999999";
const TOKEN_URL = "https://g.test/api/auth/token";
const NOW = Date.UTC(2026, 9, 11, 15, 0, 0);

function post(body: string, headers: HeadersInit | null = { "content-type": "application/json" }): Request {
  return new Request(TOKEN_URL, {
    method: "POST",
    ...(headers ? { headers } : {}),
    body,
  });
}

async function idTokenFor(
  claims: Record<string, unknown>,
  now: number,
  opts: { aud?: string; iss?: string; exp?: number; iat?: number } = {},
) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const iat = opts.iat ?? Math.floor(now / 1000);
  const exp = opts.exp ?? iat + 300;
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(opts.iss ?? "https://accounts.google.com")
    .setAudience(opts.aud ?? CLIENT)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(privateKey);
  return { token, publicKey };
}

/** A nonce-shaped JWE (claim `n`) sealed under some other audience. */
async function sealNonceAud(key: Uint8Array, aud: string, now: number): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new EncryptJWT({ n: "audience-confusion" })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer("gantree")
    .setAudience(aud)
    .setIssuedAt(iat)
    .setExpirationTime(iat + NONCE_TTL_S)
    .encrypt(key);
}

/** Session-shaped claims sealed under the nonce audience. */
async function sealSessionAud(key: Uint8Array, aud: string, now: number): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new EncryptJWT({ sub: ADA_SUB, email: "ada@example.com" })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer("gantree")
    .setAudience(aud)
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_TTL_S)
    .encrypt(key);
}

function tamper(token: string): string {
  const i = Math.max(0, token.lastIndexOf(".") - 1);
  const next = token.charAt(i) === "A" ? "B" : "A";
  return token.slice(0, i) + next + token.slice(i + 1);
}

async function redeem(
  nonce: string,
  claims: Record<string, unknown>,
  opts: {
    now?: number;
    aud?: string;
    iss?: string;
    exp?: number;
    iat?: number;
    door?: typeof env;
    headers?: HeadersInit | null;
    extra?: Record<string, unknown>;
  } = {},
) {
  const now = opts.now ?? NOW;
  const minted = await idTokenFor(claims, now, opts);
  const res = await authToken(
    post(JSON.stringify({ id_token: minted.token, nonce, ...opts.extra }), opts.headers),
    opts.door ?? env,
    memoryStore(),
    { key: minted.publicKey, now },
  );
  return res;
}

describe("native sign-in verification", () => {
  it("replays the same pair twice (stateless nonce, by design) and rejects a nonce sealed for session or oauth", async () => {
    const key = await sessionKey(SECRET);
    const nonce = await sealNonce(key, NOW);
    const claims = { sub: ADA_SUB, email: "ada@example.com", email_verified: true, nonce };
    const minted = await idTokenFor(claims, NOW);
    const body = JSON.stringify({ id_token: minted.token, nonce });
    const first = await authToken(post(body), env, memoryStore(), { key: minted.publicKey, now: NOW });
    const second = await authToken(post(body), env, memoryStore(), { key: minted.publicKey, now: NOW });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const a = await first.json<{ token: string }>();
    const b = await second.json<{ token: string }>();
    expect(await openSession(key, a.token, NOW)).toEqual({ sub: ADA_SUB, email: "ada@example.com" });
    expect(await openSession(key, b.token, NOW)).toEqual({ sub: ADA_SUB, email: "ada@example.com" });

    // The ID token is still inside its own exp; only the nonce TTL has passed.
    const later = NOW + (NONCE_TTL_S + 1) * 1000;
    const stillValid = await idTokenFor(claims, later, { exp: Math.floor(NOW / 1000) + 3600 });
    const stale = await authToken(
      post(JSON.stringify({ id_token: stillValid.token, nonce })),
      env,
      memoryStore(),
      { key: stillValid.publicKey, now: later },
    );
    expect(stale.status).toBe(401);
    expect(await stale.json()).toEqual({ error: "nonce" });

    for (const aud of ["session", "oauth"] as const) {
      const wrong = await sealNonceAud(key, aud, NOW);
      expect(await openNonce(key, wrong, NOW)).toBeNull();
      const res = await authToken(
        post(JSON.stringify({ id_token: "x", nonce: wrong })),
        env,
        memoryStore(),
        { now: NOW },
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "nonce" });
    }
  });

  it("rejects a session JWE used as the nonce, and a nonce JWE used as a bearer", async () => {
    const key = await sessionKey(SECRET);
    const session = await sealSession(key, { sub: ADA_SUB, email: "ada@example.com" }, NOW);
    const oauth = await sealOAuth(key, { state: "s", nonce: "n", verifier: "v", next: "/" }, NOW);
    const nonce = await sealNonce(key, NOW);
    for (const presented of [session, oauth]) {
      const res = await authToken(
        post(JSON.stringify({ id_token: "x", nonce: presented })),
        env,
        memoryStore(),
        { now: NOW },
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "nonce" });
    }

    const asBearer = new Request("https://g.test/api/auth/me", { headers: { Authorization: `Bearer ${nonce}` } });
    expect(await gate(asBearer, env, memoryStore(), NOW)).toMatchObject({ kind: "unauthorized", status: 401 });
    const meRes = await me(asBearer, env, memoryStore());
    expect(meRes.status).toBe(401);
    expect(await meRes.json()).toEqual({ error: "unauthorized" });

    // Same failure when the claims look like a session but the audience is nonce.
    const disguised = await sealSessionAud(key, "nonce", NOW);
    const disguisedReq = new Request("https://g.test/api/agents", { headers: { Authorization: `Bearer ${disguised}` } });
    expect(await gate(disguisedReq, env, memoryStore(), NOW)).toMatchObject({ kind: "unauthorized", status: 401 });
    expect(await readChatSession(SECRET, { authorization: `Bearer ${nonce}` }, NOW)).toBeNull();
    expect(await readChatSession(SECRET, { authorization: `Bearer ${disguised}` }, NOW)).toBeNull();
  });

  it("rejects an ID token whose nonce claim is a different valid nonce, including the inner n", async () => {
    const key = await sessionKey(SECRET);
    const posted = await sealNonce(key, NOW);
    const other = await sealNonce(key, NOW);
    const mismatch = await redeem(posted, {
      sub: ADA_SUB,
      email: "ada@example.com",
      email_verified: true,
      nonce: other,
    });
    expect(mismatch.status).toBe(401);
    expect(await mismatch.json()).toEqual({ error: "token" });

    const opened = await openNonce(key, posted, NOW);
    if (!opened) {
      throw new Error("nonce did not open");
    }
    const inner = await redeem(posted, {
      sub: ADA_SUB,
      email: "ada@example.com",
      email_verified: true,
      nonce: opened.n,
    });
    expect(inner.status).toBe(401);
    expect(await inner.json()).toEqual({ error: "token" });
  });

  it("rejects an alg=none ID token", async () => {
    const nonce = await sealNonce(await sessionKey(SECRET), NOW);
    const iat = Math.floor(NOW / 1000);
    const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "none", typ: "JWT" })));
    const payload = b64url(new TextEncoder().encode(JSON.stringify({
      iss: "https://accounts.google.com",
      aud: CLIENT,
      sub: ADA_SUB,
      email: "ada@example.com",
      email_verified: true,
      nonce,
      iat,
      exp: iat + 300,
    })));
    const res = await authToken(
      post(JSON.stringify({ id_token: `${header}.${payload}.`, nonce })),
      env,
      memoryStore(),
      { now: NOW },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "token" });
  });

  it("rejects a foreign audience and an expired ID token, and accepts issuer accounts.google.com", async () => {
    const nonce = await sealNonce(await sessionKey(SECRET), NOW);
    const claims = { sub: ADA_SUB, email: "ada@example.com", email_verified: true, nonce };
    const foreign = await redeem(nonce, claims, { aud: "other.apps.googleusercontent.com" });
    expect(foreign.status).toBe(401);
    expect(await foreign.json()).toEqual({ error: "token" });

    const iat = Math.floor(NOW / 1000) - 3600;
    const expired = await redeem(nonce, claims, { iat, exp: iat + 60 });
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({ error: "token" });

    const bare = await redeem(nonce, claims, { iss: "accounts.google.com" });
    expect(bare.status).toBe(200);
    expect(await bare.json()).toMatchObject({ sub: ADA_SUB, email: "ada@example.com" });

    const slash = await redeem(nonce, claims, { iss: "https://accounts.google.com/" });
    expect(slash.status).toBe(401);
    expect(await slash.json()).toEqual({ error: "token" });
  });

  it("lowercases Ada@Example.com for an email allowlist, and refuses email_verified false", async () => {
    const nonce = await sealNonce(await sessionKey(SECRET), NOW);
    const ok = await redeem(nonce, {
      sub: EMAIL_SUB,
      email: "Ada@Example.com",
      email_verified: true,
      nonce,
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toBeNull();
    expect(ok.headers.getSetCookie()).toEqual([]);
    const body = await ok.json<{ token: string; sub: string; email: string; exp: number }>();
    expect(body.email).toBe("ada@example.com");
    expect(body.sub).toBe(EMAIL_SUB);
    expect(body).not.toHaveProperty("role");
    expect(await openSession(await sessionKey(SECRET), body.token, NOW)).toEqual({
      sub: EMAIL_SUB,
      email: "ada@example.com",
    });

    const denied = await redeem(nonce, {
      sub: EMAIL_SUB,
      email: "Ada@Example.com",
      email_verified: false,
      nonce,
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.getSetCookie()).toEqual([]);
    const deniedBody = await denied.json<Record<string, unknown>>();
    expect(deniedBody).toEqual({ error: "not_allowed", sub: EMAIL_SUB, email: "ada@example.com" });
    expect(deniedBody).not.toHaveProperty("token");
    expect(deniedBody).not.toHaveProperty("role");

    // A sub entry matches before email is considered, so email_verified is irrelevant.
    const bySub = await redeem(nonce, {
      sub: ADA_SUB,
      email: "Ada@Example.com",
      email_verified: false,
      nonce,
    }, { door: { ...env, GANTREE_ADMINS: ADA_SUB } });
    expect(bySub.status).toBe(200);
    expect(await bySub.json()).toMatchObject({ sub: ADA_SUB, email: "ada@example.com" });
  });

  it("opens the issued token in the door and the socket, with exp in seconds and milliseconds", async () => {
    const nonce = await sealNonce(await sessionKey(SECRET), NOW);
    const res = await redeem(nonce, { sub: ADA_SUB, email: "ada@example.com", email_verified: true, nonce });
    expect(res.status).toBe(200);
    const body = await res.json<{ token: string; sub: string; email: string; exp: number }>();
    const expected = Math.floor(NOW / 1000) + SESSION_TTL_S;
    expect(Number.isInteger(body.exp)).toBe(true);
    expect(body.exp).toBe(expected);
    expect(await openSession(await sessionKey(SECRET), body.token, NOW)).toEqual({
      sub: ADA_SUB,
      email: "ada@example.com",
    });
    const { payload } = await jwtDecrypt(body.token, await sessionKey(SECRET), {
      issuer: "gantree",
      audience: "session",
      currentDate: new Date(NOW),
    });
    expect(payload.exp).toBe(body.exp);
    const chat = await readChatSession(SECRET, { authorization: `Bearer ${body.token}` }, NOW);
    expect(chat).toMatchObject({
      sub: ADA_SUB,
      email: "ada@example.com",
      emailVerified: true,
      exp: body.exp * 1000,
    });
  });

  it("returns 400 for unusable bodies, accepts extra keys, and does not consult Content-Type", async () => {
    const key = await sessionKey(SECRET);
    const nonce = await sealNonce(key, NOW);
    const bad: Array<[string, HeadersInit | null]> = [
      ["nope", { "content-type": "application/json" }],
      ["[]", { "content-type": "application/json" }],
      [JSON.stringify({ id_token: 1, nonce }), { "content-type": "application/json" }],
      [JSON.stringify({ id_token: "", nonce }), { "content-type": "application/json" }],
      [JSON.stringify({ id_token: "x", nonce: "" }), { "content-type": "application/json" }],
      ["{", { "content-type": "application/json; charset=utf-8" }],
    ];
    for (const [body, headers] of bad) {
      const res = await authToken(post(body, headers), env, memoryStore(), { now: NOW });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    }

    const claims = { sub: ADA_SUB, email: "ada@example.com", email_verified: true, nonce };
    const extra = await redeem(nonce, claims, { extra: { client: "android" } });
    expect(extra.status).toBe(200);

    const phoneType = await redeem(nonce, claims, { headers: { "content-type": "application/json; charset=utf-8" } });
    expect(phoneType.status).toBe(200);

    const minted = await idTokenFor(claims, NOW);
    const phoneHeaders = { "content-type": "application/json; charset=utf-8" };
    const reversedBody = `{"nonce":${JSON.stringify(nonce)},"id_token":${JSON.stringify(minted.token)}}`;
    const reversed = await authToken(post(reversedBody, phoneHeaders), env, memoryStore(), { key: minted.publicKey, now: NOW });
    expect(reversed.status).toBe(200);

    const junkToken = await authToken(
      post(JSON.stringify({ id_token: "junk", nonce }), phoneHeaders),
      env,
      memoryStore(),
      { now: NOW },
    );
    expect(junkToken.status).toBe(401);
    expect(await junkToken.json()).toEqual({ error: "token" });
    expect(junkToken.headers.getSetCookie()).toEqual([]);

    const junkNonce = await authToken(
      post(JSON.stringify({ id_token: "junk", nonce: "junk" }), phoneHeaders),
      env,
      memoryStore(),
      { now: NOW },
    );
    expect(junkNonce.status).toBe(401);
    expect(await junkNonce.json()).toEqual({ error: "nonce" });
    expect(junkNonce.headers.getSetCookie()).toEqual([]);

    const empty = await authToken(post("{}", phoneHeaders), env, memoryStore(), { now: NOW });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "bad_request" });
    expect(empty.headers.getSetCookie()).toEqual([]);

    const missing = await redeem(nonce, claims, { headers: null });
    expect(missing.status).toBe(200);
    expect(missing.headers.get("content-type")).toContain("application/json");

    const plain = await redeem(nonce, claims, { headers: { "content-type": "text/plain" } });
    expect(plain.status).toBe(200);
  });

  it("me returns an agents array for the bearer, and 401 for a nonce or a flipped JWE", async () => {
    const key = await sessionKey(SECRET);
    const nonce = await sealNonce(key, NOW);
    const issued = await redeem(nonce, { sub: ADA_SUB, email: "ada@example.com", email_verified: true, nonce });
    const session = await issued.json<{ token: string }>();
    const ok = await me(
      new Request("https://g.test/api/auth/me", { headers: { Authorization: `Bearer ${session.token}` } }),
      env,
      memoryStore(),
    );
    expect(ok.status).toBe(200);
    const meBody = await ok.json<{ sub: string; role: string; agents: unknown; cranes: unknown }>();
    expect(meBody.sub).toBe(ADA_SUB);
    expect(meBody.role).toBe("admin");
    expect(Array.isArray(meBody.agents)).toBe(true);
    expect(Array.isArray(meBody.cranes)).toBe(true);

    const nonceBearer = await me(
      new Request("https://g.test/api/auth/me", { headers: { Authorization: `Bearer ${nonce}` } }),
      env,
      memoryStore(),
    );
    expect(nonceBearer.status).toBe(401);
    expect(await nonceBearer.json()).toEqual({ error: "unauthorized" });

    const flipped = tamper(session.token);
    expect(flipped).not.toBe(session.token);
    const bad = await me(
      new Request("https://g.test/api/auth/me", { headers: { Authorization: `Bearer ${flipped}` } }),
      env,
      memoryStore(),
    );
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: "unauthorized" });
  });

  it("falls through a cookie that does not open, and a session bearer on a room path is the phone", async () => {
    const key = await sessionKey(SECRET);
    const other = await sessionKey(OTHER);
    const bearer = await sealSession(key, { sub: ADA_SUB, email: "ada@example.com" }, NOW);
    const nonce = await sealNonce(key, NOW);
    const foreign = await sealSession(other, { sub: EVE_SUB, email: "eve@example.com" }, NOW);
    const cookies = [`${SESSION_COOKIE}=${nonce}`, `${SESSION_COOKIE}=${foreign}`, `${SESSION_COOKIE}=garbage`];
    for (const cookie of cookies) {
      const req = new Request("https://g.test/api/auth/me", {
        headers: { cookie, Authorization: `Bearer ${bearer}` },
      });
      expect(await gate(req, env, memoryStore(), NOW)).toMatchObject({
        kind: "pass",
        who: { sub: ADA_SUB, email: "ada@example.com", role: "admin" },
      });
    }

    for (const kind of ["avatar", "backdrop", "theme"]) {
      const req = new Request(`https://g.test/api/chat/${kind}?slug=kit`, {
        headers: { Authorization: `Bearer ${bearer}` },
      });
      expect(await gate(req, env, memoryStore(), NOW)).toMatchObject({
        kind: "pass",
        who: { sub: ADA_SUB, email: "ada@example.com", role: "admin" },
      });
      const withCookie = new Request(`https://g.test/api/chat/${kind}?slug=kit`, {
        headers: { cookie: `${SESSION_COOKIE}=${bearer}`, Authorization: `Bearer ${bearer}` },
      });
      expect(await gate(withCookie, env, memoryStore(), NOW)).toMatchObject({
        kind: "pass",
        who: { sub: ADA_SUB, email: "ada@example.com", role: "admin" },
      });
    }
  });

  it("keeps a thousand nonces under 255 characters and in five compact-JWE parts", async () => {
    expect(NONCE_TTL_S).toBe(10 * 60);
    const seen = new Set<string>();
    let length = -1;
    for (let i = 0; i < 1000; i++) {
      const res = await authNonce(env);
      expect(res.status).toBe(200);
      const body = await res.json<{ nonce: string }>();
      expect(body.nonce.length).toBeGreaterThan(0);
      expect(body.nonce.length).toBeLessThan(255);
      const parts = body.nonce.split(".");
      expect(parts).toHaveLength(5);
      expect(parts[1]).toBe("");
      if (length === -1) {
        length = body.nonce.length;
      }
      expect(body.nonce.length).toBe(length);
      seen.add(body.nonce);
    }
    expect(seen.size).toBe(1000);
  }, 60_000);
});
