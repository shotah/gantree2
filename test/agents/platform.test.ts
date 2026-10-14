import { describe, expect, it } from "vitest";
import { applyPlatformGoogle, GOOGLE_HEALTH_OWN_CLIENT, GOOGLE_OWN_CLIENT } from "@/lib/agents/platform";

describe("applyPlatformGoogle", () => {
  const platform = { clientId: "plat-id", clientSecret: "plat-sec" };

  it("copies into google and google-health env unless the own flag is set", () => {
    const env = { LLM_API_KEY: "k" };
    const agentEnv = {};
    expect(applyPlatformGoogle(env, agentEnv, platform)).toEqual({
      LLM_API_KEY: "k",
      GOOGLE_OAUTH_CLIENT_ID: "plat-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "plat-sec",
      GOOGLE_HEALTH_CLIENT_ID: "plat-id",
      GOOGLE_HEALTH_CLIENT_SECRET: "plat-sec",
    });
    expect(env).toEqual({ LLM_API_KEY: "k" });
  });

  it("skips google oauth keys when GOOGLE_OWN_CLIENT is 1", () => {
    const env = { GOOGLE_OAUTH_CLIENT_ID: "mine", LLM_API_KEY: "k" };
    expect(applyPlatformGoogle(env, { [GOOGLE_OWN_CLIENT]: "1" }, platform)).toEqual({
      GOOGLE_OAUTH_CLIENT_ID: "mine",
      LLM_API_KEY: "k",
      GOOGLE_HEALTH_CLIENT_ID: "plat-id",
      GOOGLE_HEALTH_CLIENT_SECRET: "plat-sec",
    });
  });

  it("skips health keys when GOOGLE_HEALTH_OWN_CLIENT is 1", () => {
    const env = { GOOGLE_HEALTH_CLIENT_ID: "mine" };
    expect(applyPlatformGoogle(env, { [GOOGLE_HEALTH_OWN_CLIENT]: "1" }, platform)).toEqual({
      GOOGLE_HEALTH_CLIENT_ID: "mine",
      GOOGLE_OAUTH_CLIENT_ID: "plat-id",
      GOOGLE_OAUTH_CLIENT_SECRET: "plat-sec",
    });
  });
});
