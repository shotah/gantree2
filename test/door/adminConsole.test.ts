import { describe, expect, it } from "vitest";
import { adminConsoleRefusal, gate, isAdminConsolePath, isAgentSelfServiceApi } from "@/lib/door/gate";
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
  return adminConsoleRefusal(d.who, new URL(req.url), method);
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

  it("redirects members and operators away from HTML console pages", async () => {
    const store = memoryStore([{ entry: { sub: "1182", email: "op@example.com" }, role: "operator", agents: ["kit"], locked: false }]);
    const res = await sessionReq("/agents", "1182", "op@example.com", store);
    expect(res?.status).toBe(302);
    expect(res?.headers.get("location")).toBe("https://g.test/chat");
    const member = await sessionReq("/settings", "999", "bob@example.com");
    expect(member?.status).toBe(302);
  });

  it("names agent lifecycle APIs operators may call", () => {
    expect(isAgentSelfServiceApi("/api/agents/kit", "DELETE")).toBe(true);
    expect(isAgentSelfServiceApi("/api/agents/kit/enabled", "POST")).toBe(true);
    expect(isAgentSelfServiceApi("/api/agents/kit/config", "DELETE")).toBe(false);
    expect(isAgentSelfServiceApi("/api/agents/kit", "GET")).toBe(false);
  });

  it("lets operators DELETE and enable their slug but not the rest of the agents API", async () => {
    const store = memoryStore([{ entry: { sub: "1182", email: "op@example.com" }, role: "operator", agents: ["kit"], locked: false }]);
    expect(await sessionReq("/api/agents/kit", "1182", "op@example.com", store, "DELETE")).toBeNull();
    expect(await sessionReq("/api/agents/kit/enabled", "1182", "op@example.com", store, "POST")).toBeNull();
    expect((await sessionReq("/api/agents", "1182", "op@example.com", store))?.status).toBe(403);
    expect((await sessionReq("/api/agents/kit/config", "1182", "op@example.com", store))?.status).toBe(403);
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
