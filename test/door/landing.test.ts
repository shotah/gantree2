import { describe, expect, it } from "vitest";
import { agentUnion, LANDING_COOKIE, landing, landingCookie, landingPref, manageRows, readSession } from "@/lib/door/landing";
import type { Role } from "@/lib/door/users";

describe("landing pref", () => {
  it("reads chat and chat:<slug> from a cookie header; anything else is off", () => {
    expect(landingPref(null)).toBeNull();
    expect(landingPref("")).toBeNull();
    expect(landingPref("gantree.session=abc; other=1")).toBeNull();
    expect(landingPref("gantree.landing=chat")).toEqual({ slug: null });
    expect(landingPref("a=b; gantree.landing=chat%3Akit; c=d")).toEqual({ slug: "kit" });
    expect(landingPref("gantree.landing=chat:")).toEqual({ slug: null });
    expect(landingPref("gantree.landing=console")).toBeNull();
    expect(landingPref("gantree.landing=%E0%A4%A")).toBeNull();
    expect(LANDING_COOKIE).toBe("gantree.landing");
  });

  it("writes a cookie the reader round-trips, and a clearing one", () => {
    expect(landingPref(landingCookie({ slug: null }))).toEqual({ slug: null });
    expect(landingPref(landingCookie({ slug: "a b" }))).toEqual({ slug: "a b" });
    expect(landingCookie({ slug: "kit" })).toContain("Path=/; Max-Age=31536000; SameSite=Lax");
    expect(landingCookie(null)).toBe("gantree.landing=; Path=/; Max-Age=0; SameSite=Lax");
  });

  it("sends staff into chat when the pref is on, and straight to a pinned room", () => {
    expect(landing({ role: "admin", agents: ["kit"] }, { slug: null })).toBe("/chat/kit");
    expect(landing({ role: "admin", agents: [] }, { slug: null })).toBe("/chat");
    expect(landing({ role: "operator", agents: ["a", "b"] }, { slug: null })).toBe("/chat");
    expect(landing({ role: "admin", agents: [] }, { slug: "a b" })).toBe("/chat/a%20b");
    expect(landing({ role: "member", agents: ["kit", "ada"] }, { slug: "ada" })).toBe("/chat/ada");
    expect(landing({ role: "member", agents: ["kit"] }, { slug: null })).toBe("/chat/kit");
  });
});

describe("landing", () => {
  const cases: [Role, string[], string][] = [
    ["admin", [], "/agents"],
    ["admin", ["kit"], "/agents"],
    ["admin", ["kit", "ada"], "/agents"],
    ["operator", [], "/agents"],
    ["operator", ["kit"], "/agents"],
    ["operator", ["a", "b"], "/agents"],
    ["member", [], "/chat"],
    ["member", ["kit"], "/chat/kit"],
    ["member", ["a b"], "/chat/a%20b"],
    ["member", ["kit", "ada"], "/chat"],
    ["member", [""], "/chat"],
    ["member", ["  "], "/chat"],
  ];

  it.each(cases)("%s with %j goes to %s", (role, agents, path) => {
    expect(landing({ role, agents })).toBe(path);
  });
});

describe("agentUnion", () => {
  it("trims, drops blanks, dedupes, and sorts", () => {
    expect(agentUnion(["b", " a ", ""], ["a", "c"])).toEqual(["a", "b", "c"]);
    expect(agentUnion([], [])).toEqual([]);
  });
});

describe("readSession", () => {
  const body = { sub: "1182", email: "ada@example.com", role: "operator", agents: [" kit ", ""] };

  it("reads the door session and prefers agents over cranes", () => {
    expect(readSession({ ...body, cranes: ["tim"] })).toEqual({
      sub: "1182",
      email: "ada@example.com",
      role: "operator",
      agents: ["kit"],
    });
    expect(readSession({ sub: "1182", role: "member", cranes: [" tim "] })).toEqual({
      sub: "1182",
      email: null,
      role: "member",
      agents: ["tim"],
    });
    expect(readSession({ ...body, agents: [], cranes: ["tim"] })?.agents).toEqual([]);
  });

  it("rejects a body that is not a session", () => {
    expect(readSession(null)).toBeNull();
    expect(readSession("no")).toBeNull();
    expect(readSession({})).toBeNull();
    expect(readSession({ sub: "", role: "admin" })).toBeNull();
    expect(readSession({ sub: "1182", role: "guest" })).toBeNull();
    expect(readSession({ sub: "1182", role: "member", email: "" })?.email).toBeNull();
    expect(readSession({ sub: "1182", role: "member", agents: [1, "ada"] })?.agents).toEqual(["ada"]);
  });
});

describe("manageRows", () => {
  it("gates Manage and All agents", () => {
    const settings = { href: "/settings", label: "Settings" };
    expect(manageRows(null, "kit")).toEqual([]);
    expect(manageRows({ role: "member", agents: ["kit"] }, "kit")).toEqual([settings]);
    expect(manageRows({ role: "member", agents: [] }, null)).toEqual([settings]);
    expect(manageRows({ role: "admin", agents: [] }, null)).toEqual([
      { href: "/agents", label: "All agents" },
      settings,
    ]);
    expect(manageRows({ role: "admin", agents: [] }, "kit")).toEqual([
      { href: "/agents/kit", label: "Manage kit" },
      { href: "/agents", label: "All agents" },
      settings,
    ]);
    expect(manageRows({ role: "operator", agents: ["kit"] }, "kit")).toEqual([
      { href: "/agents/kit", label: "Manage kit" },
      settings,
    ]);
    expect(manageRows({ role: "operator", agents: ["ada"] }, "kit")).toEqual([settings]);
    expect(manageRows({ role: "operator", agents: ["kit"] }, null)).toEqual([settings]);
    expect(manageRows({ role: "operator", agents: [] }, "")).toEqual([settings]);
    expect(manageRows({ role: "admin", agents: [] }, "a b")).toEqual([
      { href: "/agents/a%20b", label: "Manage a b" },
      { href: "/agents", label: "All agents" },
      settings,
    ]);
  });
});
