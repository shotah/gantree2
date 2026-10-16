import { describe, expect, it } from "vitest";
import { oauthCatchRedirect, oauthRedirectPlugin } from "@/lib/agents/oauth";

describe("oauth catch redirect", () => {
  it("lists the worker catch for prod and loopback dev", () => {
    expect(oauthCatchRedirect(
      { PUBLIC_ORIGIN: "https://gantree.bldhosting.com" },
      "http://127.0.0.1:3000",
    )).toBe("https://gantree.bldhosting.com/api/auth/catch");
    expect(oauthCatchRedirect(
      { PUBLIC_ORIGIN: "https://gantree.bldhosting.com/path" },
      "http://127.0.0.1:3000",
    )).toBe("https://gantree.bldhosting.com/api/auth/catch");
    expect(oauthCatchRedirect({}, "http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000/api/auth/catch");
    expect(oauthCatchRedirect({ PUBLIC_ORIGIN: "not a url" }, "http://127.0.0.1:3000")).toBe("");
    expect(oauthRedirectPlugin("google")).toBe(true);
    expect(oauthRedirectPlugin("google-health")).toBe(true);
    expect(oauthRedirectPlugin("strava")).toBe(true);
    expect(oauthRedirectPlugin("garmin")).toBe(false);
  });
});
