/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolsFold, grantFor, missingNeeds, withGrant } from "@/app/components/agents/ToolsFold";
import { tomlFromGrants } from "@/lib/agents/mcpToml";
import type { ApiClient } from "@/app/lib/agentsHttp";
import { CAST, MAPS, config, json, inputOf, textBody } from "./fixtures";

afterEach(() => {
  cleanup();
});

describe("tool grants", () => {
  it("toggles a grant and names missing keys", () => {
    expect(withGrant([], MAPS, true)).toEqual([grantFor(MAPS)]);
    expect(withGrant([grantFor(MAPS)], { ...MAPS, binary: "next" }, true)).toEqual([grantFor({ ...MAPS, binary: "next" })]);
    expect(withGrant([grantFor(MAPS)], MAPS, false)).toEqual([]);
    expect(missingNeeds([grantFor(MAPS)], [MAPS], [])).toEqual(["maps needs MAPS_KEY"]);
    expect(missingNeeds([grantFor(MAPS)], [MAPS], ["MAPS_KEY"])).toEqual([]);
    expect(missingNeeds([{ name: "x", command: "c", env: ["Z"] }], [], [])).toEqual(["x needs Z"]);
    expect(missingNeeds([{ name: "x", command: "c" }], [], [])).toEqual([]);
  });
});

describe("ToolsFold", () => {
  it("patches mcp when a tool is ticked and unticked, and nags for a missing key", async () => {
    const onMcp = vi.fn();
    const sent: string[] = [];
    const client: ApiClient = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const body = JSON.parse(textBody(init?.body)) as { mcp: string };
      sent.push(body.mcp);
      return json(200, config({ mcp: body.mcp }));
    });
    render(<ToolsFold slug="kit" mcp="" envKeys={[]} tools={[MAPS, CAST]} canMutate client={client} onMcp={onMcp} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText("Sign in from chat before this publishes.")).toBeTruthy();
    const box = inputOf(screen.getByRole("checkbox", { name: "maps" }));
    fireEvent.click(box);
    expect(await screen.findByText("maps needs MAPS_KEY")).toBeTruthy();
    await vi.waitFor(() => expect(onMcp).toHaveBeenCalled());
    expect(sent[0]).toBe(tomlFromGrants([grantFor(MAPS)], ""));
    await vi.waitFor(() => expect(box.disabled).toBe(false));
    fireEvent.click(box);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toBe(tomlFromGrants([], ""));
  });

  it("rolls the tick back when the patch fails and disables looking-only sessions", async () => {
    const client: ApiClient = vi.fn(() => Promise.resolve(json(500, { error: "bad_json" })));
    const { rerender } = render(<ToolsFold slug="kit" mcp="" envKeys={["MAPS_KEY"]} tools={[MAPS]} canMutate client={client} onMcp={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    const box = inputOf(screen.getByRole("checkbox", { name: "maps" }));
    fireEvent.click(box);
    expect((await screen.findByRole("alert")).textContent).toContain("That request was not valid JSON.");
    await vi.waitFor(() => expect(box.checked).toBe(false));

    rerender(<ToolsFold slug="kit" mcp="" envKeys={[]} tools={[MAPS]} canMutate={false} client={vi.fn()} onMcp={vi.fn()} />);
    expect((inputOf(screen.getByRole("checkbox", { name: "maps" }))).disabled).toBe(true);
  });
});
