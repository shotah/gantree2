import { describe, expect, it } from "vitest";
import { gate, isAgentRoomRequest, isPublicPath, principalFromHeaders, principalHeaders, safeNext } from "@/lib/door/gate";
import { sealSession, SESSION_COOKIE, sessionKey } from "@/lib/door/session";
import { memoryStore } from "@/lib/door/users";

const SECRET = "0123456789abcdef0123456789abcdef-more";
const env = { SESSION_SECRET: SECRET, GANTREE_ADMINS: "ada@example.com", GANTREE_ALLOW: "bob@example.com" };
const ADA_SUB = "118212345678901234567";

async function withSession(url: string, sub: string, email: string | null) {
  const key = await sessionKey(SECRET);
  const token = await sealSession(key, { sub, email });
  return new Request(url, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
}

describe("public paths", () => {
  it("login, auth routes, assets, well-known", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/auth/google")).toBe(true);
    expect(isPublicPath("/api/auth/callback/google")).toBe(true);
    expect(isPublicPath("/api/auth/catch")).toBe(true);
    expect(isPublicPath("/api/auth/config")).toBe(true);
    expect(isPublicPath("/api/auth/nonce")).toBe(true);
    expect(isPublicPath("/api/auth/token")).toBe(true);
    expect(isPublicPath("/.well-known/celld/health")).toBe(true);
    expect(isPublicPath("/_vinext/x")).toBe(true);
    expect(isPublicPath("/manifest.webmanifest")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/api/auth/me")).toBe(false);
    expect(isPublicPath("/agents/kit")).toBe(false);
    expect(isPublicPath("/api/agents/kit/snapshot/gantry_db")).toBe(true);
    expect(isPublicPath("/api/agents/kit/snapshot/self_md")).toBe(true);
    expect(isPublicPath("/api/agents/kit/snapshot/tokens_tar")).toBe(true);
    expect(isPublicPath("/api/agents/kit/snapshot/other")).toBe(false);
    expect(isPublicPath("/api/agents/kit/config")).toBe(false);
    expect(isPublicPath("/api/agents/Kit/snapshot/gantry_db")).toBe(false);
  });

  it("safeNext keeps same-origin paths only", () => {
    expect(safeNext("/agents/kit?x=1")).toBe("/agents/kit?x=1");
    expect(safeNext("//evil.test")).toBe("/");
    expect(safeNext("https://evil.test")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

describe("gate", () => {
  it("public passes without a cookie", async () => {
    expect(await gate(new Request("https://g.test/login"), env, memoryStore())).toEqual({ kind: "public" });
    expect(await gate(new Request("https://g.test/api/agents/kit/snapshot/gantry_db?exp=1&sig=ab"), env, memoryStore())).toEqual({ kind: "public" });
  });

  it("harness bearer on a room route is the route's to check; a cookie or another path is gated", async () => {
    const bearer = { headers: { Authorization: "Bearer crane-tok" } };
    for (const kind of ["avatar", "backdrop", "theme"]) {
      const req = new Request(`https://g.test/api/chat/${kind}?slug=kit`, bearer);
      expect(isAgentRoomRequest(req)).toBe(true);
      expect(await gate(req, env, memoryStore())).toEqual({ kind: "public" });
    }
    const noHeader = new Request("https://g.test/api/chat/theme?slug=kit");
    expect(isAgentRoomRequest(noHeader)).toBe(false);
    expect(await gate(noHeader, env, memoryStore())).toMatchObject({ kind: "unauthorized", status: 401 });
    const push = new Request("https://g.test/api/chat/push?slug=kit", bearer);
    expect(isAgentRoomRequest(push)).toBe(false);
    expect(await gate(push, env, memoryStore())).toMatchObject({ kind: "unauthorized", status: 401 });
    expect(isAgentRoomRequest(new Request("https://g.test/api/chat/theme/x?slug=kit", bearer))).toBe(false);
    expect(isAgentRoomRequest(new Request("https://g.test/api/chat/theme?slug=kit", { headers: { Authorization: "Basic abc" } }))).toBe(false);
  });

  it("no admins is 503 on every gated route, even for a stranger", async () => {
    const d = await gate(new Request("https://g.test/"), { SESSION_SECRET: SECRET }, memoryStore());
    expect(d).toMatchObject({ kind: "unauthorized", status: 503 });
  });

  it("no cookie: navigation → login with next; api → 401", async () => {
    expect(await gate(new Request("https://g.test/agents/kit?tab=log"), env, memoryStore())).toEqual({ kind: "login", next: "/agents/kit?tab=log" });
    expect(await gate(new Request("https://g.test/api/auth/me"), env, memoryStore())).toMatchObject({ kind: "unauthorized", status: 401 });
    expect(await gate(new Request("https://g.test/ws/kit"), env, memoryStore())).toMatchObject({ kind: "unauthorized", status: 401 });
  });

  it("bearer session passes on api and pages; a cookie that opens wins; a bad bearer alone is 401", async () => {
    const key = await sessionKey(SECRET);
    const ada = await sealSession(key, { sub: ADA_SUB, email: "ada@example.com" });
    const bob = await sealSession(key, { sub: "2", email: "bob@example.com" });
    const api = new Request("https://g.test/api/auth/me", { headers: { Authorization: `Bearer ${ada}` } });
    expect(await gate(api, env, memoryStore())).toMatchObject({ kind: "pass", who: { sub: ADA_SUB, email: "ada@example.com", role: "admin" } });
    const page = new Request("https://g.test/agents/kit", { headers: { Authorization: `Bearer ${ada}` } });
    expect(await gate(page, env, memoryStore())).toMatchObject({ kind: "pass", who: { sub: ADA_SUB, role: "admin" } });
    const cookieWins = new Request("https://g.test/api/auth/me", {
      headers: { cookie: `${SESSION_COOKIE}=${ada}`, Authorization: "Bearer garbage" },
    });
    expect(await gate(cookieWins, env, memoryStore())).toMatchObject({ kind: "pass", who: { sub: ADA_SUB, role: "admin" } });
    const cookieOverBob = new Request("https://g.test/", {
      headers: { cookie: `${SESSION_COOKIE}=${ada}`, Authorization: `Bearer ${bob}` },
    });
    expect(await gate(cookieOverBob, env, memoryStore())).toMatchObject({ kind: "pass", who: { sub: ADA_SUB, role: "admin" } });
    const staleCookie = new Request("https://g.test/api/agents", {
      headers: { cookie: `${SESSION_COOKIE}=garbage`, Authorization: `Bearer ${bob}` },
    });
    expect(await gate(staleCookie, env, memoryStore())).toMatchObject({ kind: "pass", who: { sub: "2", role: "member" } });
    const bad = new Request("https://g.test/api/auth/me", { headers: { Authorization: "Bearer garbage" } });
    expect(await gate(bad, env, memoryStore())).toMatchObject({ kind: "unauthorized", status: 401 });
  });

  it("cookie + on the list passes with role; cookie + off the list is 401", async () => {
    const ada = await gate(await withSession("https://g.test/", ADA_SUB, "ada@example.com"), env, memoryStore());
    expect(ada).toMatchObject({ kind: "pass", who: { sub: ADA_SUB, email: "ada@example.com", role: "admin" } });
    const bob = await gate(await withSession("https://g.test/", "2", "bob@example.com"), env, memoryStore());
    expect(bob).toMatchObject({ kind: "pass", who: { role: "member" } });
    const eve = await gate(await withSession("https://g.test/", "3", "eve@example.com"), env, memoryStore());
    expect(eve).toMatchObject({ kind: "unauthorized", status: 401 });
  });

  it("a stale cookie after removal is 401 — role is never trusted from the cookie", async () => {
    const rows = [{ entry: { sub: null, email: "eve@example.com" }, role: "member" as const, agents: [], locked: false }];
    const req = await withSession("https://g.test/", "3", "eve@example.com");
    expect((await gate(req, env, memoryStore(rows))).kind).toBe("pass");
    rows.length = 0;
    expect((await gate(req, env, memoryStore(rows))).kind).toBe("unauthorized");
  });

  it("dev user only on loopback, and still has to be on the list", async () => {
    const dev = { ...env, GANTREE_DEV_USER: `${ADA_SUB}:ada@example.com` };
    expect(await gate(new Request("http://127.0.0.1:3000/"), dev, memoryStore())).toMatchObject({ kind: "pass", who: { role: "admin" } });
    expect(await gate(new Request("https://g.test/"), dev, memoryStore())).toMatchObject({ kind: "login" });
    const stranger = { ...env, GANTREE_DEV_USER: "999999999999:eve@example.com" };
    expect(await gate(new Request("http://localhost:3000/"), stranger, memoryStore())).toMatchObject({ kind: "unauthorized", status: 401 });
  });
});

describe("principal headers", () => {
  it("round-trip", () => {
    const who = { sub: ADA_SUB, email: "ada@example.com", role: "operator" as const, agents: ["kit", "zed"], entry: { sub: ADA_SUB, email: "ada@example.com" } };
    const h = new Headers(principalHeaders(who));
    expect(principalFromHeaders(h)).toEqual(who);
    expect(principalFromHeaders(new Headers())).toBeNull();
  });
});
