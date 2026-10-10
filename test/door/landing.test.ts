import { describe, expect, it } from "vitest";
import { agentUnion, landing, manageRows, readSession } from "@/lib/door/landing";
import type { Role } from "@/lib/door/users";

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
    expect(manageRows(null, "kit")).toEqual([]);
    expect(manageRows({ role: "member", agents: ["kit"] }, "kit")).toEqual([]);
    expect(manageRows({ role: "member", agents: [] }, null)).toEqual([]);
    expect(manageRows({ role: "admin", agents: [] }, null)).toEqual([
      { href: "/agents", label: "All agents" },
    ]);
    expect(manageRows({ role: "admin", agents: [] }, "kit")).toEqual([
      { href: "/agents/kit", label: "Manage kit" },
      { href: "/agents", label: "All agents" },
    ]);
    expect(manageRows({ role: "operator", agents: ["kit"] }, "kit")).toEqual([
      { href: "/agents/kit", label: "Manage kit" },
    ]);
    expect(manageRows({ role: "operator", agents: ["ada"] }, "kit")).toEqual([]);
    expect(manageRows({ role: "operator", agents: ["kit"] }, null)).toEqual([]);
    expect(manageRows({ role: "operator", agents: [] }, "")).toEqual([]);
    expect(manageRows({ role: "admin", agents: [] }, "a b")).toEqual([
      { href: "/agents/a%20b", label: "Manage a b" },
      { href: "/agents", label: "All agents" },
    ]);
  });
});
