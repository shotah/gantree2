import { describe, expect, it } from "vitest";
import { PERSONA_TEMPLATE } from "@/app/components/agents/personaTemplate";

describe("PERSONA_TEMPLATE", () => {
  it("keeps the assistant brief in product vocabulary", () => {
    expect(PERSONA_TEMPLATE).toContain("Personal assistant");
    expect(PERSONA_TEMPLATE).toContain("About you");
    expect(PERSONA_TEMPLATE.toLowerCase()).not.toMatch(/crane|yard|gantry|pendant/);
  });
});
