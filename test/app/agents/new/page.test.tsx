/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NewAgentPage, { metadata } from "@/app/agents/new/page";
import { CAST, MAPS, json } from "../../components/agents/fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NewAgentPage", () => {
  it("titles the wizard and passes home=1 through to home tools", async () => {
    expect(metadata.title).toBe("New agent — gantree");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(json(200, { tools: [MAPS, CAST] }))));
    render(await NewAgentPage({ searchParams: Promise.resolve({ home: "1" }) }));
    fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "kit" } });
    fireEvent.change(screen.getByLabelText("Shown as"), { target: { value: "Kit" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("LLM_BASE_URL"), { target: { value: "https://llm.example/v1" } });
    fireEvent.change(screen.getByLabelText("LLM_API_KEY"), { target: { value: "secret" } });
    fireEvent.change(screen.getByLabelText("LLM_MODEL"), { target: { value: "m" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("checkbox", { name: "cast" })).toBeTruthy();
  });
});
