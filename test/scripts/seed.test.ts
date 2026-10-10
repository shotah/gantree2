import { describe, expect, it } from "vitest";
import { PERSONA_TEMPLATE } from "@/app/components/agents/personaTemplate";
import {
  DEV_EMAIL,
  DEV_SUB,
  DEV_USER,
  LOG_MARKER,
  MEMBER_COOKIE_NAME,
  MEMBER_EMAIL,
  MEMBER_ENTRY,
  SEED_AGENTS,
  agentSocketUrl,
  chatScript,
  classifyCreate,
  configCall,
  createAgentCall,
  devIdentityFrom,
  ensureShotVars,
  fillBearers,
  framesToSend,
  harnessFrames,
  logMessagesFrom,
  memberCall,
  mergeAdminValue,
  parseBearerMap,
  parseDevVars,
  parseSeedArgs,
  personaFor,
  phoneSocketUrl,
  roomUsersFor,
  shouldSendLogs,
  upsertAssignment,
  usersCall,
} from "@/scripts/seed";

describe("seed args and dev vars", () => {
  it("parses flags", () => {
    expect(parseSeedArgs([])).toEqual({ help: false, varsOnly: false, base: "http://127.0.0.1:3000" });
    expect(parseSeedArgs(["--vars", "--base=http://127.0.0.1:3001"])).toEqual({
      help: false,
      varsOnly: true,
      base: "http://127.0.0.1:3001",
    });
    expect(parseSeedArgs(["-h"]).help).toBe(true);
    expect(() => parseSeedArgs(["--nope"])).toThrow(/unknown arg/);
  });

  it("reads assignments and ignores comments", () => {
    const vars = parseDevVars("# note\nGANTREE_ADMINS=a@example.com\n\nFOO=bar\n");
    expect(vars.get("GANTREE_ADMINS")).toBe("a@example.com");
    expect(vars.get("FOO")).toBe("bar");
    expect(vars.has("note")).toBe(false);
  });

  it("upserts a key without dropping the others", () => {
    const next = upsertAssignment("FOO=1\n# keep\nBAR=2\n", "BAZ", "3");
    expect(next).toContain("FOO=1");
    expect(next).toContain("# keep");
    expect(next).toContain("BAZ=3");
    expect(upsertAssignment(next, "FOO", "9")).toContain("FOO=9");
    expect(upsertAssignment(next, "FOO", "9")).not.toContain("FOO=1");
  });

  it("adds the dev user and admin email once, and only missing bearers", () => {
    const first = ensureShotVars("GANTREE_ADMINS=owner@example.com\n", "kit:aaa,ada:bbb");
    expect(first.added).toEqual(["GANTREE_DEV_USER", "GANTREE_ADMINS", "AGENT_BEARERS"]);
    expect(parseDevVars(first.text).get("GANTREE_DEV_USER")).toBe(DEV_USER);
    expect(parseDevVars(first.text).get("GANTREE_ADMINS")).toBe(`owner@example.com,${DEV_EMAIL}`);
    expect(parseDevVars(first.text).get("AGENT_BEARERS")).toBe("kit:aaa,ada:bbb");

    const again = ensureShotVars(first.text, "kit:zzz,ada:yyy");
    expect(again.added).toEqual([]);
    expect(parseDevVars(again.text).get("AGENT_BEARERS")).toBe("kit:aaa,ada:bbb");
    expect(parseDevVars(again.text).get("GANTREE_ADMINS")).toBe(`owner@example.com,${DEV_EMAIL}`);
  });

  it("admins the real dev user, not the placeholder, and leaves a covering sub:email alone", () => {
    const owner = "106136115872460439292:owner@example.com";
    const covered = ensureShotVars(`GANTREE_DEV_USER=${owner}\nGANTREE_ADMINS=${owner}\nAGENT_BEARERS=kit:a,ada:b\n`, "kit:x,ada:y");
    expect(covered.added).toEqual([]);
    expect(parseDevVars(covered.text).get("GANTREE_ADMINS")).toBe(owner);

    const bareEmail = ensureShotVars(`GANTREE_DEV_USER=${owner}\nGANTREE_ADMINS=owner@example.com\nAGENT_BEARERS=kit:a,ada:b\n`, "kit:x,ada:y");
    expect(bareEmail.added).toEqual([]);

    const missing = ensureShotVars(`GANTREE_DEV_USER=${owner}\nGANTREE_ADMINS=boss@example.com\nAGENT_BEARERS=kit:a,ada:b\n`, "kit:x,ada:y");
    expect(missing.added).toEqual(["GANTREE_ADMINS"]);
    expect(parseDevVars(missing.text).get("GANTREE_ADMINS")).toBe("boss@example.com,owner@example.com");
    expect(missing.text).not.toContain(DEV_EMAIL);
  });

  it("fills only a missing bearer slug", () => {
    expect(fillBearers("kit:keep", "kit:new,ada:fresh", ["kit", "ada"])).toBe("kit:keep,ada:fresh");
    expect(parseBearerMap("kit:keep,ada:fresh").get("ada")).toBe("fresh");
  });

  it("merges an admin email without duplicating it", () => {
    expect(mergeAdminValue("", DEV_EMAIL)).toBe(DEV_EMAIL);
    expect(mergeAdminValue("owner@example.com", DEV_EMAIL)).toBe(`owner@example.com,${DEV_EMAIL}`);
    expect(mergeAdminValue(`owner@example.com,${DEV_EMAIL}`, DEV_EMAIL)).toBe(`owner@example.com,${DEV_EMAIL}`);
  });

  it("accepts a numeric sub:email and refuses a word sub", () => {
    expect(devIdentityFrom(DEV_USER)).toEqual({ sub: DEV_SUB, email: DEV_EMAIL });
    expect(devIdentityFrom("dev-sub:dev@example.com")).toBeNull();
    expect(devIdentityFrom(undefined)).toBeNull();
  });
});

describe("seed requests", () => {
  it("builds create, config, users, and the member row", () => {
    expect(createAgentCall(SEED_AGENTS[0])).toEqual({
      method: "POST",
      path: "/api/agents",
      body: { slug: "kit", name: "Kit", tags: ["walks"] },
    });
    const config = configCall("kit", "Kit", DEV_EMAIL);
    expect(config.method).toBe("PATCH");
    expect(config.path).toBe("/api/agents/kit/config");
    const body = config.body as { persona: string; mcp: string };
    expect(body.persona).toContain("**Name:** Kit");
    expect(body.persona).toContain(PERSONA_TEMPLATE.slice(0, 12));
    expect(body.mcp).toContain('name = "maps"');
    expect(body.mcp).toContain('name = "google"');
    expect(usersCall("ada", { sub: DEV_SUB, email: DEV_EMAIL })).toEqual({
      method: "PUT",
      path: "/api/agents/ada/users",
      body: {
        users: [
          { sub: DEV_SUB, email: DEV_EMAIL },
          { sub: "100000000000000000002", email: MEMBER_EMAIL },
        ],
      },
    });
    expect(memberCall()).toEqual({
      method: "POST",
      path: "/api/users",
      body: { entry: MEMBER_ENTRY, role: "member", agents: [] },
    });
  });

  it("treats 409 as already created", () => {
    expect(classifyCreate(201)).toBe("created");
    expect(classifyCreate(409)).toBe("present");
    expect(classifyCreate(500)).toBe("failed");
  });

  it("names the agent in the persona and keeps the template", () => {
    const text = personaFor("Ada", "Sam", MEMBER_EMAIL);
    expect(text.startsWith("# PERSONA.md")).toBe(true);
    expect(text).toContain("**Name:** Ada");
    expect(text).toContain("**Name:** Sam");
    expect(text).toContain(MEMBER_EMAIL);
    expect(text).not.toContain("(pick one)");
  });

  it("gives each agent the dev user and the member", () => {
    expect(roomUsersFor({ sub: DEV_SUB, email: DEV_EMAIL })).toHaveLength(2);
    expect(roomUsersFor({ sub: "100000000000000000002", email: MEMBER_EMAIL })).toHaveLength(1);
  });
});

describe("seed frames", () => {
  it("sends status before perf and skips logs that are already there", () => {
    const frames = harnessFrames();
    expect(frames[0]?.kind).toBe("status");
    expect(frames.some((frame) => frame.kind === "perf")).toBe(true);
    expect(frames.some((frame) => frame.kind === "log" && frame.message === LOG_MARKER)).toBe(true);
    expect(shouldSendLogs(["turn ok"])).toBe(true);
    expect(shouldSendLogs([LOG_MARKER])).toBe(false);
    const again = framesToSend([LOG_MARKER]);
    expect(again.some((frame) => frame.kind === "log")).toBe(false);
    expect(again[0]?.kind).toBe("status");
    expect(logMessagesFrom({ lines: [{ message: LOG_MARKER }, { message: 1 }, "no"] })).toEqual([LOG_MARKER]);
    expect(logMessagesFrom(null)).toEqual([]);
  });

  it("reuses chat ids so a second seed replaces instead of duplicating", () => {
    const once = chatScript(DEV_SUB);
    const twice = chatScript(DEV_SUB);
    expect(once.map((line) => line.body.id)).toEqual(["seed-kit-in-1", "seed-kit-re-1", "seed-kit-in-2"]);
    expect(twice.map((line) => line.body.id)).toEqual(once.map((line) => line.body.id));
    expect(once.filter((line) => line.role === "phone")).toHaveLength(2);
    expect(once[1]?.body.user_id).toBe(DEV_SUB);
  });

  it("points sockets at the agent and phone roles", () => {
    expect(agentSocketUrl("http://127.0.0.1:3000", "kit")).toBe("ws://127.0.0.1:3000/ws/kit?role=agent");
    expect(phoneSocketUrl("https://gantree.example", "ada")).toBe("wss://gantree.example/ws/ada?role=phone");
  });

  it("names the member cookie file without a home path", () => {
    expect(MEMBER_COOKIE_NAME).toBe("gantree2-member-cookie");
  });
});
