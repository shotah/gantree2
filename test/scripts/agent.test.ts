import { describe, expect, it } from "vitest";
import {
  type AgentArgs,
  applyDevVars,
  baseHost,
  chatUrl,
  classifyHealthProbe,
  collectSecrets,
  decideCreateAgent,
  decideEnsureAgentGet,
  decideRestartAgent,
  formatBanner,
  formatPublished,
  isGantreeHealth,
  isHealthFetchDown,
  missingLlm,
  parseArgs,
  parseDevVars,
  pollGantreeHealth,
  redact,
  roomWithDev,
  statusFromBody,
} from "@/scripts/agent";

const defaults: AgentArgs = { slug: "kit", port: 3000 };

describe("parseArgs", () => {
  it("defaults to kit on port 3000", () => {
    expect(parseArgs([])).toEqual(defaults);
  });

  it("reads slug and port", () => {
    expect(parseArgs(["--slug", "ada", "--port", "4000"])).toEqual({ slug: "ada", port: 4000 });
    expect(parseArgs(["--slug=ada", "--port=4000"])).toEqual({ slug: "ada", port: 4000 });
  });

  it("rejects unknown REPL flags, bare words, and bad values", () => {
    expect(() => parseArgs(["--db"])).toThrow(/unknown flag --db/);
    expect(() => parseArgs(["--fresh"])).toThrow(/unknown flag --fresh/);
    expect(() => parseArgs(["--verbose"])).toThrow(/unknown flag --verbose/);
    expect(() => parseArgs(["--once"])).toThrow(/unknown flag --once/);
    expect(() => parseArgs(["--nope"])).toThrow(/unknown flag/);
    expect(() => parseArgs(["hello"])).toThrow(/unexpected argument/);
    expect(() => parseArgs(["--slug"])).toThrow(/missing value for --slug/);
    expect(() => parseArgs(["--port"])).toThrow(/missing value for --port/);
    expect(() => parseArgs(["--slug", ""])).toThrow(/bad slug/);
    expect(() => parseArgs(["--port", "0"])).toThrow(/bad port/);
  });
});

describe("dev vars and LLM keys", () => {
  it("lists missing house LLM keys", () => {
    expect(missingLlm({})).toEqual(["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"]);
    expect(missingLlm({
      LLM_BASE_URL: "https://example.com",
      LLM_API_KEY: "key",
      LLM_MODEL: "m",
    })).toEqual([]);
    expect(missingLlm({ LLM_BASE_URL: "  ", LLM_API_KEY: "x", LLM_MODEL: "y" })).toEqual(["LLM_BASE_URL"]);
  });

  it("overlays .dev.vars without clobbering existing env", () => {
    const file = [
      "LLM_MODEL=file-model",
      "LLM_API_KEY=file-key",
      "GANTREE_DEV_USER=1:a@b.com",
    ].join("\n");
    const merged = applyDevVars(file, { LLM_MODEL: "env-model" });
    expect(merged.LLM_MODEL).toBe("env-model");
    expect(merged.LLM_API_KEY).toBe("file-key");
    expect(merged.GANTREE_DEV_USER).toBe("1:a@b.com");
    expect(parseDevVars('LLM_API_KEY="quoted"').get("LLM_API_KEY")).toBe("quoted");
  });
});

describe("banner and URLs", () => {
  it("extracts the LLM host and chat URL", () => {
    expect(baseHost("https://generativelanguage.googleapis.com/v1beta/openai")).toBe("generativelanguage.googleapis.com");
    expect(baseHost("not a url")).toBe("unknown-host");
    expect(chatUrl(3000, "kit")).toBe("http://127.0.0.1:3000/chat/kit");
    expect(formatPublished(["maps", "math"])).toBe("maps,math");
    expect(formatPublished([])).toBe("none");
    expect(formatBanner({
      slug: "kit",
      model: "gemini",
      host: "generativelanguage.googleapis.com",
      chatUrl: "http://127.0.0.1:3000/chat/kit",
      state: "ready",
      published: ["maps"],
    })).toBe(
      "kit  gemini  generativelanguage.googleapis.com  http://127.0.0.1:3000/chat/kit  state=ready  published=maps",
    );
  });
});

describe("health and HTTP decisions", () => {
  it("recognizes gantree health", () => {
    expect(isGantreeHealth(200, { ok: true, version: "0.2.22" })).toBe(true);
    expect(isGantreeHealth(200, { ok: false })).toBe(false);
    expect(isGantreeHealth(404, { ok: true })).toBe(false);
    expect(classifyHealthProbe(200, { ok: true }, false).kind).toBe("gantree");
    expect(classifyHealthProbe(200, {}, false).kind).toBe("busy");
    expect(classifyHealthProbe(0, null, true).kind).toBe("down");
    expect(classifyHealthProbe(0, null, false).kind).toBe("busy");
  });

  it("treats fetch failures (including timeouts) as down, not busy", () => {
    expect(isHealthFetchDown(new DOMException("timed out", "TimeoutError"))).toBe(true);
    expect(isHealthFetchDown(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isHealthFetchDown(Object.assign(new Error("reset"), { cause: { code: "ECONNRESET" } }))).toBe(true);
    expect(isHealthFetchDown(new TypeError("fetch failed"))).toBe(true);
    expect(classifyHealthProbe(0, null, isHealthFetchDown(new Error("TimeoutError"))).kind).toBe("down");
  });

  it("keeps polling after busy or down probes until gantree health", async () => {
    let calls = 0;
    const result = await pollGantreeHealth(async () => {
      calls += 1;
      if (calls === 1) return { kind: "down", status: 0, body: null };
      if (calls === 2) return { kind: "busy", status: 503, body: null };
      return { kind: "gantree", status: 200, body: { ok: true } };
    }, () => true, 5_000, 1);
    expect(result.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it("maps agent API statuses", () => {
    expect(decideEnsureAgentGet(200)).toBe("exists");
    expect(decideEnsureAgentGet(404)).toBe("missing");
    expect(decideEnsureAgentGet(401)).toBe("auth");
    expect(decideEnsureAgentGet(500)).toBe("fail");

    expect(decideCreateAgent(201)).toBe("created");
    expect(decideCreateAgent(409)).toBe("present");
    expect(decideCreateAgent(403)).toBe("auth");
    expect(decideCreateAgent(400)).toBe("fail");

    expect(decideRestartAgent(200)).toBe("ok");
    expect(decideRestartAgent(403)).toBe("auth");
    expect(decideRestartAgent(502)).toBe("fail");
  });

  it("pulls harness fields from restart JSON", () => {
    expect(statusFromBody({ state: "ready", published: ["maps", 1] })).toEqual({
      state: "ready",
      published: ["maps"],
    });
    expect(statusFromBody(null)).toEqual({});
  });
});

describe("roomWithDev", () => {
  it("does not add when the dev sub is already on the room list", () => {
    const existing = [{ sub: "100000000000000000001", email: "dev@example.com" }];
    const result = roomWithDev(existing, { sub: "100000000000000000001", email: "other@example.com" });
    expect(result.added).toBe(false);
    expect(result.users).toEqual(existing);
  });

  it("appends the dev user and keeps other rows", () => {
    const existing = [{ sub: "100000000000000000002", email: "sam@example.com" }];
    const result = roomWithDev(existing, { sub: "100000000000000000001", email: "dev@example.com" });
    expect(result.added).toBe(true);
    expect(result.users).toEqual([
      ...existing,
      { sub: "100000000000000000001", email: "dev@example.com" },
    ]);
  });

  it("omits email on the new row when empty and skips add when sub is empty", () => {
    expect(roomWithDev([], { sub: "100000000000000000001" })).toEqual({
      added: true,
      users: [{ sub: "100000000000000000001" }],
    });
    expect(roomWithDev([{ sub: "100000000000000000002" }], { sub: "   ", email: "a@b.com" })).toEqual({
      added: false,
      users: [{ sub: "100000000000000000002" }],
    });
  });
});

describe("redact", () => {
  it("strips secret-like env values from error text", () => {
    const env = {
      LLM_BASE_URL: "https://secret-host.example/v1",
      LLM_API_KEY: "super-secret-key-value",
      LLM_MODEL: "m",
      SESSION_SECRET: "longsessionsecret",
    };
    const secrets = collectSecrets(env);
    expect(secrets.length).toBeGreaterThan(0);
    const msg = `failed: ${env.LLM_API_KEY} at ${env.LLM_BASE_URL}`;
    expect(redact(msg, secrets)).not.toContain(env.LLM_API_KEY);
    expect(redact(msg, secrets)).not.toContain(env.LLM_BASE_URL);
    expect(redact(msg, secrets)).toContain("[redacted]");
  });
});
