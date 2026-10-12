import { describe, expect, it } from "vitest";
import { PERSONA_TEMPLATE, personaFor, scrubPersonaPlaceholders } from "@/app/components/agents/personaTemplate";

describe("PERSONA_TEMPLATE", () => {
  it("keeps the assistant brief in product vocabulary", () => {
    expect(PERSONA_TEMPLATE).toContain("Personal assistant");
    expect(PERSONA_TEMPLATE).toContain("About you");
    expect(PERSONA_TEMPLATE.toLowerCase()).not.toMatch(/crane|yard|gantry|pendant/);
  });
});

describe("personaFor", () => {
  it("bakes the agent name and leaves the human name placeholder", () => {
    const out = personaFor({ agentName: "George" });
    expect(out).toContain("Your name is George.");
    expect(out).toContain("- **Name:** George");
    expect(out).not.toContain("(pick one)");
    expect(out).not.toContain("Pick a name and keep it.");
    expect(out).toContain("- **Name:** Your Name");
  });

  it("fills the canonical email when provided", () => {
    const out = personaFor({ agentName: "Ada", email: "ada@example.com" });
    expect(out).toContain("**Google / Workspace email (canonical):** ada@example.com");
    expect(out).not.toContain("you@example.com");
  });

  it("skips email when empty", () => {
    const out = personaFor({ agentName: "Ada", email: "  " });
    expect(out).toContain("you@example.com");
  });
});

describe("scrubPersonaPlaceholders", () => {
  it("replaces stale placeholders on an edited persona", () => {
    const edited = PERSONA_TEMPLATE.replace("warm, sharp", "calm, dry");
    const out = scrubPersonaPlaceholders(edited, { agentName: "George", email: "g@co.com" });
    expect(out).toContain("calm, dry");
    expect(out).toContain("- **Name:** George");
    expect(out).toContain("g@co.com");
    expect(out).not.toContain("(pick one)");
  });
});
