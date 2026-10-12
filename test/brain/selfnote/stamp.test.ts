import { describe, expect, it } from "vitest";
import { body, header, notesOnly, stamp } from "@/brain/selfnote/stamp";

describe("notesOnly", () => {
  it("strips a doubled kernel header and keeps note bullets", () => {
    const notes = "- Direct, sharp, warm, zero fluff.";
    const doubled = `${stamp(notes)}\n\n${header}`;
    expect(notesOnly(doubled)).toBe(notes);
    expect(body(doubled)).toContain("# SELF.md");
    expect(notesOnly(doubled)).not.toContain("self_note");
  });

  it("returns empty when the file is header-only", () => {
    expect(notesOnly(header)).toBe("");
    expect(notesOnly(stamp(""))).toBe("");
  });
});
