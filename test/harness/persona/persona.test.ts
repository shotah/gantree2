import { describe, expect, it } from "vitest";
import { assemblePersona, filePersona, fileSelf, legacyFiles, resolveTimezone, syncKernel, timezoneOf, type PersonaPart } from "@/harness/persona";

function part(name: string, text: string): PersonaPart {
  return { name, text };
}

describe("assemblePersona", () => {
  it("orders PERSONA then SELF and ignores extras", () => {
    const got = assemblePersona([
      part("ZZZ.md", "extra-z"),
      part(filePersona, "persona-body"),
      part(fileSelf, "self-body"),
      part("SOUL.md", "soul-leftover"),
      part("AAA.md", "extra-a"),
      part("notes.txt", "ignored"),
    ]);
    const personaIdx = got.indexOf("persona-body");
    const selfIdx = got.indexOf("self-body");
    expect(personaIdx).toBeGreaterThanOrEqual(0);
    expect(selfIdx).toBeGreaterThan(personaIdx);
    for (const bad of ["extra-z", "soul-leftover", "extra-a", "ignored"]) {
      expect(got).not.toContain(bad);
    }
  });

  it("is empty when nothing was provided", () => {
    expect(assemblePersona([])).toBe("");
  });

  it("tolerates a missing SELF part", () => {
    expect(assemblePersona([part(filePersona, "only-persona")])).toContain("only-persona");
  });

  it("stamps SELF and the kernel persona sections", () => {
    const got = assemblePersona([
      part(fileSelf, "# SELF.md — Who You Are Becoming\n\n> stale\n\n- dry humor\n"),
      part(filePersona, "# PERSONA.md\n\n## Identity lock\n\nhold id\n\n## Self-notes (`self_note` → SELF.md)\n\n- stale rule\n\n## Memory hygiene\n\nhold mem\n"),
    ]);
    expect(got).not.toContain("stale");
    expect(got).toContain("north-star aims");
    expect(got).toContain("- dry humor");
    expect(got).toContain("A north-star is one sentence");
    expect(got).toContain("hold mem");
    expect(got).toContain("A vibe word is not a joke");
    expect(got).toContain("## Location pins");
    expect(got).toContain("[location]");
    expect(got).toContain("## Follow-up");
    expect(got).toContain("[wait]");
    expect(got).toContain("## Reactions");
    expect(got).toContain("[react <emoji>]");
    expect(got).toContain("👎");
    expect(got).toContain("[input] spoken");
    expect(got).toContain("Pendant GPS");
    expect(got).toContain("maps `near`");
    expect(got).not.toContain("A Telegram location or venue updates");
  });

  it("uses the self-note argument ahead of a SELF.md part", () => {
    const got = assemblePersona([part(filePersona, "persona-body"), part(fileSelf, "from-part")], "from-store");
    expect(got).toContain("from-store");
    expect(got).not.toContain("from-part");
  });
});

describe("syncKernel", () => {
  it("rewrites the persona section", () => {
    const old = "# PERSONA.md\n\n## Self-notes (`self_note` → SELF.md)\n\n- stale\n\n## Memory hygiene\n\nok\n";
    const { parts, removed } = syncKernel([part(filePersona, old)]);
    expect(removed).toEqual([]);
    const got = parts.find((p) => p.name === filePersona)?.text ?? "";
    expect(got).not.toContain("- stale");
    expect(got).toContain("A north-star is one sentence");
    expect(got).toContain("## Memory hygiene");
    expect(got).toContain("## Follow-up");
    expect(got).toContain("[wait]");
    expect(got).toContain("## Location pins");
    expect(got).toContain("## Reactions");
    expect(got).toContain("[react <emoji>]");
  });

  it("migrates and removes legacy files", () => {
    const { parts, removed } = syncKernel([
      part("SOUL.md", "soul-body"),
      part("RULES.md", "## Memory hygiene\n\nrules-body"),
      part("USER.md", "user-body"),
      part("TOOLS.md", "tools-body"),
      part(fileSelf, "self-body"),
      part("keep.md", "should-stay"),
    ]);
    expect(removed).toEqual([...legacyFiles]);
    expect(parts.some((p) => (legacyFiles as readonly string[]).includes(p.name))).toBe(false);
    expect(parts.some((p) => p.name === "keep.md")).toBe(true);
    const persona = parts.find((p) => p.name === filePersona)?.text ?? "";
    for (const want of ["soul-body", "rules-body", "user-body", "tools-body"]) {
      expect(persona).toContain(want);
    }
    expect(persona).toContain("A north-star is one sentence");
    const loaded = assemblePersona(parts);
    expect(loaded).toContain("soul-body");
    expect(loaded).toContain("self-body");
    expect(loaded).not.toContain("should-stay");
  });

  it("keeps an existing persona when removing legacy files", () => {
    const { parts, removed } = syncKernel([
      part(filePersona, "keep-me\n\n## Memory hygiene\n\nok\n"),
      part("SOUL.md", "old-soul"),
    ]);
    expect(removed).toEqual(["SOUL.md"]);
    const persona = parts.find((p) => p.name === filePersona)?.text ?? "";
    expect(persona).toContain("keep-me");
    expect(persona).not.toContain("old-soul");
  });
});

describe("timezone", () => {
  it("reads an IANA zone from persona markdown", () => {
    for (const input of [
      "- **Timezone:** America/Los_Angeles\n- **Location:** Seattle",
      "Timezone: America/Los_Angeles",
      "**Timezone:** America/Los_Angeles",
    ]) {
      expect(timezoneOf(input)).toBe("America/Los_Angeles");
    }
    expect(timezoneOf("no tz here")).toBe("");
    expect(timezoneOf("- **Timezone:** Not/AZone")).toBe("");
  });

  it("prefers persona markdown over the fallback", () => {
    const fromPersona = resolveTimezone("- **Timezone:** America/Los_Angeles", "UTC");
    expect(fromPersona).toEqual({ name: "America/Los_Angeles", source: filePersona });
    expect(resolveTimezone("", "America/New_York")).toEqual({ name: "America/New_York", source: "CRON_TZ" });
    const empty = resolveTimezone("", "");
    expect(empty.name).toBe("America/Los_Angeles");
    expect(empty.source).toBe("CRON_TZ");
  });
});
