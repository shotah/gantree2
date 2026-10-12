import { describe, expect, it } from "vitest";
import {
  applyConfigPatch,
  canonicalEnv,
  configFrame,
  configView,
  emptyConfig,
  needsRecreate,
  parseConfig,
  startedEnvFor,
} from "@/lib/agents/config";

describe("config", () => {
  it("redacts env and treats a missing row as empty", () => {
    expect(parseConfig(null)).toEqual(emptyConfig());
    expect(parseConfig([])).toEqual(emptyConfig());
    expect(parseConfig({ env: { LLM_API_KEY: "sekrit", nope: 1, constructor: "x" }, mcp: "toml", persona: "hi", updatedAt: 4 })).toMatchObject({
      env: { LLM_API_KEY: "sekrit" },
      mcp: "toml",
      persona: "hi",
      updatedAt: 4,
    });
    const view = configView(parseConfig({ env: { B: "2", A: "1" }, mcp: "", persona: "", updatedAt: null }), null);
    expect(view).toEqual({ envKeys: ["A", "B"], house: [], mcp: "", persona: "", updatedAt: null, recreate: false });
    expect(JSON.stringify(view)).not.toContain("sekrit");
    expect(configView(emptyConfig(), null, ["LLM_MODEL"]).house).toEqual(["LLM_MODEL"]);
  });

  it("patches env with null deletes, leaves omitted fields, and bumps updatedAt only on change", () => {
    const start = { env: { A: "1", B: "2" }, mcp: "old", persona: "p", updatedAt: 1 };
    const same = applyConfigPatch(start, { env: { A: "1" }, mcp: "old" }, 9);
    expect(same).toEqual({ ok: true, changed: false, config: start });
    const next = applyConfigPatch(start, { env: { B: null, C: "3" }, persona: "next" }, 9);
    expect(next).toEqual({
      ok: true,
      changed: true,
      config: { env: { A: "1", C: "3" }, mcp: "old", persona: "next", updatedAt: 9 },
    });
    expect(start.env).toEqual({ A: "1", B: "2" });
  });

  it("rejects a bad patch and a key pile past the cap", () => {
    const start = emptyConfig();
    const bad: unknown[] = [
      null,
      [],
      { env: [] },
      { env: { "bad-key": "x" } },
      { env: { constructor: "x" } },
      { env: { A: 1 } },
      { env: { A: "li\nne" } },
      { env: { A: "" } },
      { env: { A: "\n" } },
      { env: { A: "  " } },
      { mcp: 1 },
      { persona: 1 },
    ];
    for (const patch of bad) {
      expect(applyConfigPatch(start, patch, 1)).toEqual({ ok: false, error: "bad_config" });
    }
    const env: Record<string, string> = {};
    for (let i = 0; i < 65; i++) {
      env[`K${i}`] = "v";
    }
    expect(applyConfigPatch(start, { env }, 1)).toEqual({ ok: false, error: "bad_config" });
    expect(applyConfigPatch(start, { mcp: "x".repeat(262_145) }, 1)).toEqual({ ok: false, error: "bad_config" });
  });

  it("stores a pasted secret with its trailing newline trimmed", () => {
    const start = emptyConfig();
    const next = applyConfigPatch(start, { env: { GOOGLE_OAUTH_CLIENT_SECRET: "sekrit\n" } }, 3);
    expect(next).toEqual({
      ok: true,
      changed: true,
      config: { env: { GOOGLE_OAUTH_CLIENT_SECRET: "sekrit" }, mcp: "", persona: "", updatedAt: 3 },
    });
  });

  it("recreates only after a start and a later env change", () => {
    const config = { ...emptyConfig(), env: { A: "1" } };
    expect(needsRecreate(config.env, null)).toBe(false);
    const started = startedEnvFor(config);
    expect(needsRecreate(config.env, started)).toBe(false);
    expect(canonicalEnv({ B: "2", A: "1" })).toBe(canonicalEnv({ A: "1", B: "2" }));
    expect(needsRecreate({ A: "2" }, started)).toBe(true);
    expect(configView(config, started).recreate).toBe(false);
    expect(configView({ ...config, env: { A: "2" } }, started).recreate).toBe(true);
  });

  it("ignores a runtime field on a stored row and on a patch", () => {
    expect(parseConfig({ mcp: "x", runtime: "container" })).toEqual({ ...emptyConfig(), mcp: "x" });
    const start = emptyConfig();
    const same = applyConfigPatch(start, { runtime: "native" }, 4);
    expect(same).toEqual({ ok: true, changed: false, config: start });
  });

  it("builds a config frame from env, mcp, and persona", () => {
    const frame = JSON.parse(configFrame(
      { env: { LLM_API_KEY: "sekrit" }, mcp: "toml", persona: "be brief", updatedAt: 1 },
    )) as { kind: string; env: { LLM_API_KEY: string }; mcp: string; persona: string; restore?: unknown };
    expect(frame.kind).toBe("config");
    expect(frame.env.LLM_API_KEY).toBe("sekrit");
    expect(frame.mcp).toBe("toml");
    expect(frame.persona).toBe("be brief");
    expect(frame.restore).toBeUndefined();
  });

  it("lays the house floor under the agent env; the agent's own key wins", () => {
    const frame = JSON.parse(configFrame(
      { env: { LLM_MODEL: "mine" }, mcp: "", persona: "", updatedAt: 1 },
      { LLM_MODEL: "house", LLM_API_KEY: "house-key" },
    )) as { env: Record<string, string> };
    expect(frame.env).toEqual({ LLM_MODEL: "mine", LLM_API_KEY: "house-key" });
  });

  it("drops SNAPSHOT_KEY from the frame", () => {
    const frame = JSON.parse(configFrame(
      { env: { SNAPSHOT_KEY: "user-key", LLM_API_KEY: "sekrit" }, mcp: "", persona: "", updatedAt: 1 },
      { SNAPSHOT_KEY: "house-key" },
    )) as { env: Record<string, string> };
    expect(frame.env.SNAPSHOT_KEY).toBeUndefined();
    expect(frame.env.LLM_API_KEY).toBe("sekrit");
  });
});
