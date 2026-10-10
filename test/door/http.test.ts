import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { finishGoogle, guard, loginUrl, logout, me, startGoogle } from "@/lib/door/http";
import { OAUTH_COOKIE, openOAuth, openSession, readCookie, sealOAuth, sealSession, SESSION_COOKIE, sessionKey } from "@/lib/door/session";
import { memoryStore } from "@/lib/door/users";

const SECRET = "0123456789abcdef0123456789abcdef-more";
const CLIENT = "123-abc.apps.googleusercontent.com";
const env = { SESSION_SECRET: SECRET, GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: "sec", GANTREE_ADMINS: "ada@example.com" };
const ADA_SUB = "118212345678901234567";

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

function cookieValue(res: Response, name: string): string | null {
  const line = setCookies(res).find((c) => c.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).split(";")[0] : null;
}

async function idTokenFor(claims: Record<string, unknown>) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  await exportJWK(publicKey);
  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer("https://accounts.google.com")
    .setAudience(CLIENT)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return { token, publicKey };
}

describe("startGoogle", () => {
  it("302s to Google and seals state/nonce/verifier/next in the oauth cookie", async () => {
    const res = await startGoogle(new Request("https://g.test/api/auth/google?next=/agents/kit"), env);
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!);
    expect(to.hostname).toBe("accounts.google.com");
    const raw = cookieValue(res, OAUTH_COOKIE);
    const claims = await openOAuth(await sessionKey(SECRET), raw!);
    expect(claims?.state).toBe(to.searchParams.get("state"));
    expect(claims?.nonce).toBe(to.searchParams.get("nonce"));
    expect(claims?.next).toBe("/agents/kit");
    expect(setCookies(res)[0]).toContain("Secure");
  });

  it("503 when not configured", async () => {
    const res = await startGoogle(new Request("https://g.test/api/auth/google"), { SESSION_SECRET: SECRET });
    expect(res.status).toBe(503);
  });
});

describe("finishGoogle", () => {
  async function started(next = "/agents/kit") {
    const key = await sessionKey(SECRET);
    const claims = { state: "st", nonce: "no", verifier: "ver", next };
    const cookie = await sealOAuth(key, claims);
    return { claims, cookie: `${OAUTH_COOKIE}=${cookie}` };
  }

  it("happy path: session cookie set, oauth cookie cleared, 302 to next", async () => {
    const { cookie } = await started();
    const { token, publicKey } = await idTokenFor({ sub: ADA_SUB, email: "ada@example.com", email_verified: true, nonce: "no" });
    const fetchFn: typeof fetch = async () => new Response(JSON.stringify({ id_token: token }));
    const res = await finishGoogle(
      new Request("https://g.test/api/auth/callback/google?code=c&state=st", { headers: { cookie } }),
      env,
      memoryStore(),
      { fetchFn, key: publicKey },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://g.test/agents/kit");
    const session = cookieValue(res, SESSION_COOKIE);
    expect(await openSession(await sessionKey(SECRET), session!)).toEqual({ sub: ADA_SUB, email: "ada@example.com" });
    expect(setCookies(res).find((c) => c.startsWith(`${OAUTH_COOKIE}=`))).toContain("Max-Age=0");
  });

  it("bounces: no cookie, bad state, exchange failure, bad token, not on the list — never a session", async () => {
    const { cookie } = await started();
    const url = "https://g.test/api/auth/callback/google?code=c&state=st";
    const cases: Array<[Request, Partial<Parameters<typeof finishGoogle>[3]>, string]> = [
      [new Request(url), {}, "expired"],
      [new Request("https://g.test/api/auth/callback/google?code=c&state=WRONG", { headers: { cookie } }), {}, "state"],
      [new Request(url, { headers: { cookie } }), { fetchFn: async () => new Response("no", { status: 400 }) }, "exchange"],
    ];
    const { token, publicKey } = await idTokenFor({ sub: ADA_SUB, email: "ada@example.com", email_verified: true, nonce: "OTHER" });
    cases.push([new Request(url, { headers: { cookie } }), { fetchFn: async () => new Response(JSON.stringify({ id_token: token })), key: publicKey }, "token"]);
    const eve = await idTokenFor({ sub: "9", email: "eve@example.com", email_verified: true, nonce: "no" });
    cases.push([new Request(url, { headers: { cookie } }), { fetchFn: async () => new Response(JSON.stringify({ id_token: eve.token })), key: eve.publicKey }, "not_allowed"]);

    for (const [req, deps, code] of cases) {
      const res = await finishGoogle(req, env, memoryStore(), deps);
      expect(res.status).toBe(302);
      const to = new URL(res.headers.get("location")!);
      expect(to.pathname).toBe("/login");
      expect(to.searchParams.get("error")).toBe(code);
      expect(cookieValue(res, SESSION_COOKIE)).toBeNull();
    }
  });

  it("bounces not_configured without touching Google", async () => {
    const res = await finishGoogle(new Request("https://g.test/api/auth/callback/google?code=c&state=st"), { SESSION_SECRET: SECRET }, memoryStore());
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("not_configured");
  });
});

describe("me / logout / guard", () => {
  async function sessionReq(path: string) {
    const token = await sealSession(await sessionKey(SECRET), { sub: ADA_SUB, email: "ada@example.com" });
    return new Request(`https://g.test${path}`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  }

  it("me returns the principal with a session, 401 without, 503 with no admins", async () => {
    const ok = await me(await sessionReq("/api/auth/me"), env, memoryStore());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ sub: ADA_SUB, email: "ada@example.com", role: "admin", agents: [], cranes: [] });
    // Room admission merges into `agents`; grants and rooms are one sorted set; `cranes` is the alias copy.
    const withRooms = await me(await sessionReq("/api/auth/me"), env, memoryStore(), async (who) => [who.agents.length ? "x" : "kit", "ada"]);
    expect(await withRooms.json()).toMatchObject({ agents: ["ada", "kit"], cranes: ["ada", "kit"] });
    expect((await me(new Request("https://g.test/api/auth/me"), env, memoryStore())).status).toBe(401);
    expect((await me(new Request("https://g.test/api/auth/me"), { SESSION_SECRET: SECRET }, memoryStore())).status).toBe(503);
  });

  it("logout clears the cookie and sends you to /login", () => {
    const res = logout(new Request("https://g.test/api/auth/logout", { method: "POST" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://g.test/login");
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
    expect(readCookie(new Request("https://g.test/", { headers: { cookie: res.headers.get("set-cookie")! } }), SESSION_COOKIE)).toBe("");
  });

  it("guard: null for public and pass, redirect for pages, json for api", async () => {
    expect(await guard(new Request("https://g.test/login"), env, memoryStore())).toBeNull();
    expect(await guard(await sessionReq("/agents/kit"), env, memoryStore())).toBeNull();
    const page = await guard(new Request("https://g.test/agents/kit?x=1"), env, memoryStore());
    expect(page?.status).toBe(302);
    expect(page?.headers.get("location")).toBe("https://g.test/login?next=%2Fagents%2Fkit%3Fx%3D1");
    const api = await guard(new Request("https://g.test/api/agents"), env, memoryStore());
    expect(api?.status).toBe(401);
    expect(api?.headers.get("content-type")).toContain("application/json");
  });

  it("loginUrl omits next when it is home", () => {
    expect(loginUrl(new URL("https://g.test/x"), "/")).toBe("https://g.test/login");
    expect(loginUrl(new URL("https://g.test/x"), "/a", "state")).toBe("https://g.test/login?next=%2Fa&error=state");
  });
});
