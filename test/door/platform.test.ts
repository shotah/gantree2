import { describe, expect, it } from "vitest";
import { effectiveGoogle } from "@/lib/door/platform";

describe("effectiveGoogle", () => {
  it("prefers stored values and marks deploy fall-through", () => {
    expect(effectiveGoogle(
      { clientId: "deploy-id", clientSecret: "deploy-sec" },
      { clientId: "stored-id", clientSecret: "stored-sec" },
    )).toEqual({
      clientId: "stored-id",
      clientSecret: "stored-sec",
      idFromDeploy: false,
      secretFromDeploy: false,
    });
  });

  it("falls through blank stored fields to deploy", () => {
    expect(effectiveGoogle(
      { clientId: "deploy-id", clientSecret: "deploy-sec" },
      { clientId: "", clientSecret: "" },
    )).toEqual({
      clientId: "deploy-id",
      clientSecret: "deploy-sec",
      idFromDeploy: true,
      secretFromDeploy: true,
    });
  });
});
