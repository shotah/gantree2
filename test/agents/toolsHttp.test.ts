import { describe, expect, it } from "vitest";
import { toolCatalog } from "@/lib/agents/catalog";
import { getTools } from "@/lib/agents/toolsHttp";

function request(role: string | null): Request {
  const headers = new Headers();
  if (role) {
    headers.set("x-gantree-sub", "118212345678901234567");
    headers.set("x-gantree-email", "ada@example.com");
    headers.set("x-gantree-role", role);
    headers.set("x-gantree-agents", "kit");
  }
  return new Request("https://g.test/api/tools", { headers });
}

describe("getTools", () => {
  it("returns the catalog for any signed-in role", async () => {
    for (const role of ["admin", "operator", "member"]) {
      const res = getTools(request(role));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ tools: toolCatalog(), house: [] });
    }
  });

  it("names the house keys the Worker env supplies, never their values", async () => {
    const res = getTools(request("member"), { LLM_MODEL: "gemini", LLM_API_KEY: " sekrit ", LLM_BASE_URL: "" });
    const body = await res.json<{ house: string[] }>();
    expect(body.house).toEqual(["LLM_API_KEY", "LLM_MODEL"]);
    expect(JSON.stringify(body)).not.toContain("sekrit");
  });

  it("401s when the principal headers are missing or nonsense", async () => {
    for (const req of [request(null), request("stranger")]) {
      const res = getTools(req);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });
});
