import { describe, expect, it } from "vitest";
import { type Decision, PRINCIPAL_HEADER_NAMES, principalFromHeaders } from "@/lib/door/gate";
import { forwardHeaders, refusal } from "@/lib/door/http";

const pass: Decision = {
  kind: "pass",
  who: { sub: "118", email: "ada@example.com", role: "operator", agents: ["kit", "ada"], entry: { sub: "118", email: "ada@example.com" } },
};

describe("forwardHeaders", () => {
  it("drops client-sent principal headers on every decision", () => {
    const spoof = new Headers({ "x-gantree-sub": "1", "x-gantree-role": "admin", "x-gantree-agents": "kit", accept: "text/html" });
    for (const d of [{ kind: "public" }, { kind: "login", next: "/" }, { kind: "unauthorized", status: 401, reason: "unauthorized" }] as const) {
      const out = forwardHeaders(d, spoof);
      for (const name of PRINCIPAL_HEADER_NAMES) {
        expect(out.has(name)).toBe(false);
      }
      expect(out.get("accept")).toBe("text/html");
      expect(principalFromHeaders(out)).toBeNull();
    }
  });

  it("writes the gate's principal on pass, overriding a spoof", () => {
    const spoof = new Headers({ "x-gantree-sub": "1", "x-gantree-role": "admin", cookie: "gantree_session=x" });
    const out = forwardHeaders(pass, spoof);
    expect(principalFromHeaders(out)).toEqual(pass.who);
    expect(out.get("cookie")).toBe("gantree_session=x");
  });

  it("does not mutate the incoming headers", () => {
    const incoming = new Headers({ "x-gantree-role": "admin" });
    forwardHeaders(pass, incoming);
    expect(incoming.get("x-gantree-role")).toBe("admin");
  });
});

describe("refusal", () => {
  const url = new URL("https://g.test/agents/kit?x=1");

  it("lets public and pass through", () => {
    expect(refusal({ kind: "public" }, url)).toBeNull();
    expect(refusal(pass, url)).toBeNull();
  });

  it("redirects a page to login with next, answers an api in json", async () => {
    const login = refusal({ kind: "login", next: "/agents/kit?x=1" }, url);
    expect(login?.status).toBe(302);
    expect(login?.headers.get("location")).toBe("https://g.test/login?next=%2Fagents%2Fkit%3Fx%3D1");
    const denied = refusal({ kind: "unauthorized", status: 503, reason: "no admins" }, url);
    expect(denied?.status).toBe(503);
    expect(await denied?.json()).toEqual({ error: "no admins" });
  });
});
