import { describe, expect, it } from "vitest";
import { adminConsoleRefusal, gate, isAdminConsolePath, isAgentScopedPath } from "@/lib/door/gate";
import { sealSession, SESSION_COOKIE, sessionKey } from "@/lib/door/session";
import { memoryStore } from "@/lib/door/users";

const SECRET = "0123456789abcdef0123456789abcdef-more";
const env = { SESSION_SECRET: SECRET, GANTREE_ADMINS: "ada@example.com", GANTREE_ALLOW: "bob@example.com" };

async function sessionReq(path: string, sub: string, email: string, store = memoryStore(), method = "GET") {
  const key = await sessionKey(SECRET);
  const token = await sealSession(key, { sub, email });
  const req = new Request(`https://g.test${path}`, { method, headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  const d = await gate(req, env, store);
  expect(d.kind).toBe("pass");
  if (d.kind !== "pass") {
    throw new Error("expected pass");
  }
  return adminConsoleRefusal(d.who, new URL(req.url));
}

describe("admin console paths", () => {
  it("names settings, users, agents, and their APIs", () => {
    expect(isAdminConsolePath("/settings")).toBe(true);
    expect(isAdminConsolePath("/users")).toBe(true);
    expect(isAdminConsolePath("/agents/new")).toBe(true);
    expect(isAdminConsolePath("/api/agents/kit/config")).toBe(true);
    expect(isAdminConsolePath("/api/users")).toBe(true);
    expect(isAdminConsolePath("/chat")).toBe(false);
    expect(isAdminConsolePath("/api/tools")).toBe(false);
  });

  it("names agent-scoped page and API paths", () => {
    expect(isAgentScopedPath("/agents/kit")).toBe(true);
    expect(isAgentScopedPath("/api/agents/kit")).toBe(true);
    expect(isAgentScopedPath("/api/agents/kit/config")).toBe(true);
    expect(isAgentScopedPath("/api/agents/kit/enabled")).toBe(true);
    expect(isAgentScopedPath("/agents")).toBe(false);
    expect(isAgentScopedPath("/agents/new")).toBe(false);
    expect(isAgentScopedPath("/api/agents")).toBe(false);
    expect(isAgentScopedPath("/settings")).toBe(false);
    expect(isAgentScopedPath("/api/users")).toBe(false);
  });

  it("redirects members and operators away from HTML console pages", async () => {
    const store = memoryStore([{ entry: { sub: "1182", email: "op@example.com" }, role: "operator", agents: ["kit"], locked: false }]);
    const res = await sessionReq("/agents", "1182", "op@example.com", store);
    expect(res?.status).toBe(302);
    expect(res?.headers.get("location")).toBe("https://g.test/chat");
    const member = await sessionReq("/settings", "999", "bob@example.com");
    expect(member?.status).toBe(302);
  });

  it("lets operators and members through agent-scoped paths but not the rest of the console", async () => {
    const opStore = memoryStore([{ entry: { sub: "1182", email: "op@example.com" }, role: "operator", agents: ["kit"], locked: false }]);
    expect(await sessionReq("/agents/kit", "1182", "op@example.com", opStore)).toBeNull();
    expect(await sessionReq("/api/agents/kit/config", "1182", "op@example.com", opStore)).toBeNull();
    expect((await sessionReq("/agents/new", "1182", "op@example.com", opStore))?.status).toBe(302);
    expect((await sessionReq("/agents", "1182", "op@example.com", opStore))?.status).toBe(302);
    expect((await sessionReq("/api/agents", "1182", "op@example.com", opStore))?.status).toBe(403);
    expect((await sessionReq("/api/users", "1182", "op@example.com", opStore))?.status).toBe(403);

    expect(await sessionReq("/agents/kit", "999", "bob@example.com")).toBeNull();
    expect(await sessionReq("/api/agents/kit/config", "999", "bob@example.com")).toBeNull();
    expect((await sessionReq("/agents/new", "999", "bob@example.com"))?.status).toBe(302);
    expect((await sessionReq("/agents", "999", "bob@example.com"))?.status).toBe(302);
    expect((await sessionReq("/api/agents", "999", "bob@example.com"))?.status).toBe(403);
    expect((await sessionReq("/api/users", "999", "bob@example.com"))?.status).toBe(403);
  });

  it("403s members and operators on console APIs", async () => {
    const store = memoryStore([{ entry: { sub: "1182", email: "op@example.com" }, role: "operator", agents: ["kit"], locked: false }]);
    const agents = await sessionReq("/api/agents", "1182", "op@example.com", store);
    expect(agents?.status).toBe(403);
    expect(await agents?.json()).toEqual({ error: "forbidden" });
    const users = await sessionReq("/api/users", "999", "bob@example.com");
    expect(users?.status).toBe(403);
  });

  it("lets an admin through", async () => {
    const admin = await sessionReq("/agents", "118212345678901234567", "ada@example.com");
    expect(admin).toBeNull();
    const api = await sessionReq("/api/agents", "118212345678901234567", "ada@example.com");
    expect(api).toBeNull();
  });
});
