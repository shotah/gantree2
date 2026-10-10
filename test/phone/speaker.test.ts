import { describe, expect, it } from "vitest";
import {
  speakBarLabel,
  speakFailFromStatus,
  speakFailHint,
  speakPhaseAfter,
  speakStatus,
} from "@/lib/phone/speaker";

describe("speaker", () => {
  it("names the Worker answer: 404 is no voice, 401 is the session, 429 is busy, the rest is Google", () => {
    expect(speakFailFromStatus(404)).toBe("no-voice");
    expect(speakFailFromStatus(401)).toBe("unauthorized");
    expect(speakFailFromStatus(403)).toBe("unauthorized");
    expect(speakFailFromStatus(429)).toBe("busy");
    expect(speakFailFromStatus(502)).toBe("vendor");
    expect(speakFailFromStatus(500)).toBe("vendor");
  });

  it("is live while fetching or playing, quiet after done or failed", () => {
    expect(speakPhaseAfter({ phase: "fetching" })).toBe("fetching");
    expect(speakPhaseAfter({ phase: "playing" })).toBe("playing");
    expect(speakPhaseAfter({ phase: "done" })).toBe("idle");
    expect(speakPhaseAfter({ phase: "failed", reason: "vendor" })).toBe("idle");
  });

  it("paints the header and the bar only while live", () => {
    expect(speakStatus("fetching")).toBe("voice…");
    expect(speakStatus("playing")).toBe("speaking");
    expect(speakStatus("idle")).toBe("");
    expect(speakBarLabel("fetching")).toBe("Fetching voice…");
    expect(speakBarLabel("playing")).toBe("Speaking · hold to cut in");
    expect(speakBarLabel("idle")).toBe("");
  });

  it("says why a reply stayed silent, and nothing when there was nothing to say", () => {
    expect(speakFailHint("no-voice")).toMatch(/no TTS key/);
    expect(speakFailHint("unauthorized")).toMatch(/sign in/);
    expect(speakFailHint("busy")).toMatch(/too many/);
    expect(speakFailHint("vendor")).toMatch(/Google/);
    expect(speakFailHint("offline")).toMatch(/reach the Worker/);
    expect(speakFailHint("play")).toMatch(/would not play/);
    expect(speakFailHint("empty")).toBe("");
  });
});
