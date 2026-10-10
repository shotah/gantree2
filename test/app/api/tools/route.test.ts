import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/tools/route";
import { toolCatalog } from "@/lib/agents/catalog";

describe("GET /api/tools", () => {
  it("delegates to the tools handler", async () => {
    const res = GET(new Request("https://g.test/api/tools", {
      headers: {
        "x-gantree-sub": "118212345678901234567",
        "x-gantree-role": "member",
      },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tools: toolCatalog() });
  });
});
