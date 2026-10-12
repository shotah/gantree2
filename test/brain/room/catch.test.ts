import { describe, expect, it } from "vitest";
import { catchOAuth, type CatchEnv } from "@/brain/room/catch";
import { openOAuthCatch, sealNonce, sealOAuthCatch, sealSession, SESSION_COOKIE, sessionKey } from "@/lib/door/session";
import { memoryStore } from "@/lib/door/users";

const SECRET = "0123456789abcdef0123456789abcdef-more";
const ADMIN = "123456789012345678901";
const MEMBER = "123456789012345678902";
const OPERATOR = "123456789012345678903";

function envFor(handler: (req: Request) => Promise<Response> | Response, over: Partial<CatchEnv> = {}) {
  const seen: Request[] = [];
  const env = {
    SESSION_SECRET: SECRET,
    GANTREE_ADMINS: ADMIN,
    GANTREE_ALLOW: MEMBER,
    AGENT: {
      idFromName: (name: string) => ({ name }) as DurableObjectId,
      get: () => ({
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const req = input instanceof Request ? input : new Request(input, init);
          seen.push(req);
          return handler(req);
        },
      }),
    },
    ...over,
  };
  return { env: env as unknown as CatchEnv, seen };
}

async function cookieFor(sub: string, email: string | null = "ada@example.com"): Promise<string> {
  const token = await sealSession(await sessionKey(SECRET), { sub, email });
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

async function authed(url: string, sub: string): Promise<Request> {
  return new Request(url, { headers: { cookie: await cookieFor(sub) } });
}

describe("oauth catch", () => {
  it("finishes the code on the agent's DO and tells the human to go back", async () => {
    const key = await sessionKey(SECRET);
    const state = await sealOAuthCatch(key, { slug: "kit", plugin: "google" });
    expect(await openOAuthCatch(key, state)).toEqual({ slug: "kit", plugin: "google" });
    const { env, seen } = envFor(() => Response.json({ ok: true }));
    const res = await catchOAuth(await authed(`https://g.test/api/auth/catch?state=${encodeURIComponent(state)}&code=abc`, ADMIN), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("Connected google. Go back to chat.");
    expect(seen).toHaveLength(1);
    const req = seen[0];
    if (!req) {
      throw new Error("missing auth call");
    }
    expect(req.headers.get("X-Chat-Op")).toBe("auth");
    expect(await req.json()).toEqual({
      plugin: "google",
      code: "abc",
      redirectUri: "https://g.test/api/auth/catch",
      userId: ADMIN,
    });
  });

  it("uses PUBLIC_ORIGIN for the redirect the provider already listed", async () => {
    const key = await sessionKey(SECRET);
    const state = await sealOAuthCatch(key, { slug: "kit", plugin: "strava" });
    const { env, seen } = envFor(() => Response.json({ ok: true }), {
      PUBLIC_ORIGIN: "https://gantree2.bldhosting.com/path",
    });
    const res = await catchOAuth(
      await authed(`http://127.0.0.1:3000/api/auth/catch?state=${encodeURIComponent(state)}&code=abc`, ADMIN),
      env,
    );
    expect(res.status).toBe(200);
    const req = seen[0];
    if (!req) {
      throw new Error("missing auth call");
    }
    expect(await req.json()).toMatchObject({ redirectUri: "https://gantree2.bldhosting.com/api/auth/catch" });
  });

  it("lets a room member through and refuses everyone else", async () => {
    const key = await sessionKey(SECRET);
    const state = await sealOAuthCatch(key, { slug: "kit", plugin: "google" });
    const url = `https://g.test/api/auth/catch?state=${encodeURIComponent(state)}&code=abc`;
    const { env, seen } = envFor((req) => {
      if (req.headers.get("X-Chat-Op") === "allow") {
        return Response.json({ users: [{ sub: MEMBER }] });
      }
      return Response.json({ ok: true });
    });
    const anon = await catchOAuth(new Request(url), env);
    expect(anon.status).toBe(401);
    expect(await anon.text()).toBe("unauthorized");
    const junk = await catchOAuth(new Request(url, { headers: { cookie: `${SESSION_COOKIE}=nope` } }), env);
    expect(junk.status).toBe(401);
    expect(seen).toEqual([]);

    const stranger = await catchOAuth(await authed(url, "123456789012345678909"), env);
    expect(stranger.status).toBe(401);

    const { env: blocked, seen: blockedSeen } = envFor((req) => {
      if (req.headers.get("X-Chat-Op") === "allow") {
        return Response.json({ users: [] });
      }
      return Response.json({ ok: true });
    });
    const member = await catchOAuth(await authed(url, MEMBER), blocked);
    expect(member.status).toBe(403);
    expect(await member.text()).toBe("forbidden");
    expect(blockedSeen.map((req) => req.headers.get("X-Chat-Op"))).toEqual(["allow"]);

    const operatorStore = memoryStore([{
      entry: { sub: OPERATOR, email: null },
      role: "operator",
      agents: ["kit"],
      locked: false,
    }]);
    const { env: opEnv, seen: opSeen } = envFor(() => Response.json({ users: [] }));
    const operator = await catchOAuth(await authed(url, OPERATOR), opEnv, operatorStore);
    expect(operator.status).toBe(403);
    expect(opSeen.map((req) => req.headers.get("X-Chat-Op"))).toEqual(["allow"]);

    const allowed = await catchOAuth(await authed(url, MEMBER), env);
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe("Connected google. Go back to chat.");
    const auth = seen.at(-1);
    if (!auth) {
      throw new Error("missing auth call");
    }
    expect(auth.headers.get("X-Chat-Op")).toBe("auth");
    expect(await auth.json()).toMatchObject({ userId: MEMBER, plugin: "google" });
  });

  it("rejects a bad, expired, or foreign state and does not call the DO", async () => {
    const key = await sessionKey(SECRET);
    const { env, seen } = envFor(() => Response.json({ ok: true }));
    const nonce = await sealNonce(key);
    const expired = await sealOAuthCatch(key, { slug: "kit", plugin: "google" }, Date.now() - (31 * 60 * 1000));
    const cases = [
      "https://g.test/api/auth/catch?state=nope&code=abc",
      `https://g.test/api/auth/catch?state=${encodeURIComponent(nonce)}&code=abc`,
      `https://g.test/api/auth/catch?state=${encodeURIComponent(expired)}&code=abc`,
      "https://g.test/api/auth/catch?code=abc",
    ];
    for (const url of cases) {
      const res = await catchOAuth(await authed(url, ADMIN), env);
      expect(res.status).toBe(400);
      expect(await res.text()).toBe("bad state");
    }
    const missing = await catchOAuth(
      await authed(`https://g.test/api/auth/catch?state=${encodeURIComponent(await sealOAuthCatch(key, { slug: "kit", plugin: "garmin" }))}`, ADMIN),
      env,
    );
    expect(missing.status).toBe(400);
    expect(await missing.text()).toBe("missing code");
    expect(seen).toEqual([]);
  });

  it("returns the DO failure message as one line and never the code", async () => {
    const key = await sessionKey(SECRET);
    const state = await sealOAuthCatch(key, { slug: "kit", plugin: "google" });
    const code = "auth/code";
    const encoded = encodeURIComponent(code);
    const { env, seen } = envFor(() => Response.json({
      error: "auth_failed",
      message: `exchange failed\n${code}\n${encoded}\r\nclick Connect again`,
    }, { status: 502 }));
    const res = await catchOAuth(
      await authed(`https://g.test/api/auth/catch?state=${encodeURIComponent(state)}&code=${encoded}`, ADMIN),
      env,
    );
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toBe("exchange failed click Connect again");
    expect(body).not.toContain(code);
    expect(body).not.toContain(encoded);
    expect(body.includes("\n")).toBe(false);
    const req = seen[0];
    if (!req) {
      throw new Error("missing auth call");
    }
    expect(await req.json()).toMatchObject({ code });
  });

  it("caps a long failure message at 240 characters", async () => {
    const key = await sessionKey(SECRET);
    const state = await sealOAuthCatch(key, { slug: "kit", plugin: "google" });
    const { env } = envFor(() => Response.json({
      error: "auth_failed",
      message: "m".repeat(250),
    }, { status: 400 }));
    const res = await catchOAuth(
      await authed(`https://g.test/api/auth/catch?state=${encodeURIComponent(state)}&code=abc`, ADMIN),
      env,
    );
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toBe("m".repeat(240));
    expect(body).not.toContain("abc");
  });

  it("says could not connect when the DO sends no message", async () => {
    const key = await sessionKey(SECRET);
    const state = await sealOAuthCatch(key, { slug: "kit", plugin: "google" });
    const url = `https://g.test/api/auth/catch?state=${encodeURIComponent(state)}&code=abc`;
    const cases = [
      () => Response.json({ error: "auth_failed" }, { status: 502 }),
      () => new Response("nope", { status: 502 }),
      () => Response.json({ message: "" }, { status: 502 }),
      () => Response.json({ message: "   \n" }, { status: 502 }),
      () => Response.json({ message: "abc" }, { status: 502 }),
    ];
    for (const handler of cases) {
      const { env } = envFor(handler);
      const res = await catchOAuth(await authed(url, ADMIN), env);
      expect(res.status).toBe(502);
      expect(await res.text()).toBe("could not connect");
    }
    const { env: down } = envFor(() => {
      throw new Error("down abc");
    });
    const thrown = await catchOAuth(await authed(url, ADMIN), down);
    expect(thrown.status).toBe(502);
    expect(await thrown.text()).toBe("could not connect");
  });
});
