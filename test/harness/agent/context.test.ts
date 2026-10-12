import { describe, expect, it } from "vitest";
import { standingPersona } from "@/harness/agent/context";
import { PERSONA_PRECEDENCE_NOTE } from "@/harness/memory/format";
import { TOOL_NARRATION_NOTE } from "@/harness/agent/notes";

describe("standingPersona", () => {
  it("prepends the name fact and bakes placeholders when a name is given", () => {
    const assembled = "Pick a name and keep it.\n\n- **Name:** (pick one)";
    const out = standingPersona(assembled, "George");
    expect(out.startsWith("Your name is George. Use that name for yourself. The human's name is under About you.")).toBe(true);
    expect(out).toContain("Your name is George.");
    expect(out).toContain("- **Name:** George");
    expect(out).not.toContain("(pick one)");
    expect(out).toContain(TOOL_NARRATION_NOTE);
    expect(out).toContain(PERSONA_PRECEDENCE_NOTE.trim());
  });

  it("omits the name fact when the name is empty", () => {
    const assembled = "Pick a name and keep it.";
    const out = standingPersona(assembled, "");
    expect(out).toContain("Pick a name and keep it.");
    expect(out).not.toMatch(/^Your name is /);
  });

  it("derives from slug-style names via the harness caller, not here", () => {
    const out = standingPersona("", "George");
    expect(out).toContain("Your name is George. Use that name for yourself.");
  });
});
