import { describe, expect, it } from "vitest";
import { HOUSE_KEYS, houseEnv, houseKeys, llmCovered } from "@/lib/agents/house";

describe("house keys", () => {
  it("picks only the house keys, trimmed, skipping blanks and non-strings", () => {
    const env = {
      LLM_BASE_URL: " https://llm.example/v1 ",
      LLM_API_KEY: "",
      LLM_MODEL: "gemini-3.8-flash",
      SEARCH_API_KEY: "   ",
      SEARCH_PROVIDER: " brave ",
      GOOGLE_CLIENT_SECRET: "never",
      SESSION_SECRET: "never",
    };
    expect(houseEnv(env)).toEqual({
      LLM_BASE_URL: "https://llm.example/v1",
      LLM_MODEL: "gemini-3.8-flash",
      SEARCH_PROVIDER: "brave",
    });
    expect(houseKeys(env)).toEqual(["LLM_BASE_URL", "LLM_MODEL", "SEARCH_PROVIDER"]);
    expect(houseEnv(undefined)).toEqual({});
    expect(houseKeys({})).toEqual([]);
  });

  it("keeps the key order stable for screens", () => {
    const env = Object.fromEntries(HOUSE_KEYS.map((key) => [key, "x"]));
    expect(houseKeys(env)).toEqual([...HOUSE_KEYS]);
  });

  it("covers LLM_* from the agent, the house, or both", () => {
    expect(llmCovered([], [])).toBe(false);
    expect(llmCovered(["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"], [])).toBe(true);
    expect(llmCovered([], ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "SEARCH_API_KEY"])).toBe(true);
    expect(llmCovered(["LLM_API_KEY"], ["LLM_BASE_URL", "LLM_MODEL"])).toBe(true);
    expect(llmCovered(["LLM_API_KEY"], ["LLM_BASE_URL"])).toBe(false);
  });
});
