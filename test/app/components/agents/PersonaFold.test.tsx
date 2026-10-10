/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersonaFold } from "@/app/components/agents/PersonaFold";
import type { ApiClient } from "@/app/lib/agentsHttp";
import { config, json, areaOf, textBody } from "./fixtures";

afterEach(() => {
  cleanup();
});

describe("PersonaFold", () => {
  it("saves the draft and reports a failure", async () => {
    const onPersona = vi.fn();
    const sent: string[] = [];
    let fail = false;
    const client: ApiClient = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      if (fail) {
        return json(500, { error: "bad_json" });
      }
      const body = JSON.parse(textBody(init?.body)) as { persona: string };
      sent.push(body.persona);
      return json(200, config({ persona: body.persona }));
    });
    render(<PersonaFold slug="kit" persona="Be brief." canMutate client={client} onPersona={onPersona} />);
    fireEvent.click(screen.getByRole("button", { name: "Persona" }));
    const field = areaOf(screen.getByLabelText("Persona text"));
    expect(field.value).toBe("Be brief.");
    fireEvent.change(field, { target: { value: "Be sharp." } });
    fireEvent.click(screen.getByRole("button", { name: "Save persona" }));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(onPersona).toHaveBeenCalledWith("Be sharp.");
    expect(sent).toEqual(["Be sharp."]);

    fail = true;
    fireEvent.change(screen.getByLabelText("Persona text"), { target: { value: "Again." } });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save persona" }));
    expect((await screen.findByRole("alert")).textContent).toContain("That request was not valid JSON.");
  });

  it("hides save when the session cannot change the agent", () => {
    render(<PersonaFold slug="kit" persona="Be brief." canMutate={false} client={vi.fn()} onPersona={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Persona" }));
    expect((areaOf(screen.getByLabelText("Persona text"))).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save persona" })).toBeNull();
  });
});
