import { describe, expect, it } from "vitest";
import { classifyReason, driftReason, toolErrorText, unavailableMessage } from "@/harness/tools/errors";

describe("classifyReason", () => {
  it("maps boot and tool text onto stable codes", () => {
    const cases: [string, string][] = [
      ["executable file not found in $PATH", "no_binary"],
      ["exec: \"google-mcp\": executable file not found in $PATH", "no_binary"],
      ["open /usr/bin/foo: no such file or directory", "no_binary"],
      ["dial: executable file not found in $PATH", "no_binary"],
      ["missing env GOOGLE_MAPS_API_KEY", "no_key"],
      ["GOOGLE_MAPS_API_KEY is not set", "no_key"],
      ["need an API key", "no_key"],
      ["oauth token missing", "no_oauth"],
      ["401 unauthorized", "no_oauth"],
      ["not authenticated", "no_oauth"],
      ["cannot spawn", "connect"],
      ["", "connect"],
    ];
    for (const [input, want] of cases) {
      expect(classifyReason(input), input).toBe(want);
    }
  });
});

describe("driftReason", () => {
  it("re-reads a connect failure against stderr and keeps a specific reason", () => {
    expect(driftReason("connect", "", "mcp server error: RENTCAST_API_KEY is required")).toBe("no_key");
    expect(driftReason("connect", "", "STRAVA_CLIENT_ID environment variable is required")).toBe("no_key");
    expect(driftReason("connect", "", "not logged in, run: garmin login")).toBe("connect");
    expect(driftReason("no_oauth", "api key", "")).toBe("no_oauth");
    expect(driftReason("", "", "oauth: not authenticated")).toBe("no_oauth");
  });
});

describe("tool error text", () => {
  it("brackets key, oauth, and binary failures and leaves the rest generic", () => {
    expect(toolErrorText("401 unauthorized")).toContain("tool error [no_oauth]:");
    expect(toolErrorText("boom")).toBe("tool error: boom");
    expect(toolErrorText("executable file not found in $PATH")).toContain("tool error [no_binary]:");
    expect(toolErrorText("tool error [no_key]: already wrapped")).toBe("tool error [no_key]: already wrapped");
  });

  it("tells the model not to invent names for a skipped server", () => {
    const text = unavailableMessage("google", "no_oauth", "no token file");
    for (const want of ["tool error [no_oauth]", "google is skipped", "do not invent google__*"]) {
      expect(text).toContain(want);
    }
    expect(unavailableMessage("google", "no_oauth")).toBe(
      "tool error [no_oauth]: google is skipped — do not invent google__* names",
    );
  });
});
