import { describe, expect, it, vi } from "vitest";
import { toolCatalog } from "@/lib/agents/catalog";

const door = vi.hoisted(() => {
  const env: Record<string, unknown> = {};
  return { env };
});

vi.mock("@/lib/door/runtime", () => ({
  doorEnv: () => door.env,
}));

import { GET } from "@/app/api/tools/route";

describe("GET /api/tools", () => {
  it("delegates to the tools handler and names the house keys", async () => {
    door.env = { LLM_MODEL: "gemini-3.8-flash" };
    const res = GET(new Request("https://g.test/api/tools", {
      headers: {
        "x-gantree-sub": "118212345678901234567",
        "x-gantree-role": "member",
      },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tools: toolCatalog(), house: ["LLM_MODEL"] });
  });
});
