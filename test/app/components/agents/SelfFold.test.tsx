/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelfFold } from "@/app/components/agents/SelfFold";
import type { ApiClient } from "@/app/lib/agentsHttp";
import { areaOf, href, json, textBody } from "./fixtures";

const NOTE = "# SELF.md — Who You Are Becoming\n\n- dry humor\n- calls them Boss";

afterEach(() => {
  cleanup();
});

function clientFor(note = NOTE, failEmpty = false): { client: ApiClient; sent: string[] } {
  const sent: string[] = [];
  const client: ApiClient = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    await Promise.resolve();
    const method = init?.method ?? "GET";
    if (method === "GET") {
      return json(200, { text: note, maxChars: 4096 });
    }
    const body = JSON.parse(textBody(init?.body)) as { text: string };
    sent.push(body.text);
    if (failEmpty && body.text.trim() === "") {
      return json(400, { error: "empty" });
    }
    return json(200, { text: body.text, maxChars: 4096 });
  });
  return { client, sent };
}

describe("SelfFold", () => {
  it("prunes a line, reverts, and saves the draft", async () => {
    const { client, sent } = clientFor();
    render(<SelfFold slug="kit" canMutate client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Self notes" }));
    const field = areaOf(await screen.findByLabelText("Self notes text"));
    expect(field.value).toBe(NOTE);
    expect(screen.getByLabelText("Self notes length").textContent).toBe(`${String(new TextEncoder().encode(NOTE).length)} / 4096`);

    fireEvent.click(screen.getByRole("button", { name: "Remove line 3: - dry humor" }));
    expect(field.value).not.toContain("dry humor");
    expect(field.value).toContain("calls them Boss");

    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(field.value).toBe(NOTE);

    fireEvent.click(screen.getByRole("button", { name: "Remove line 3: - dry humor" }));
    fireEvent.click(screen.getByRole("button", { name: "Save self notes" }));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(sent).toEqual([NOTE.replace("- dry humor\n", "")]);
    expect(href(vi.mocked(client).mock.calls[0]?.[0] ?? "")).toBe("/api/agents/kit/self");
  });

  it("shows the store's empty refusal", async () => {
    const { client } = clientFor(NOTE, true);
    render(<SelfFold slug="kit" canMutate client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Self notes" }));
    const field = areaOf(await screen.findByLabelText("Self notes text"));
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save self notes" }));
    expect((await screen.findByRole("alert")).textContent).toContain("SELF.md cannot be empty.");
  });

  it("hides prune and save when the session cannot change the agent", async () => {
    const { client } = clientFor();
    render(<SelfFold slug="kit" canMutate={false} client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Self notes" }));
    expect(areaOf(await screen.findByLabelText("Self notes text")).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save self notes" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove line/ })).toBeNull();
  });
});
