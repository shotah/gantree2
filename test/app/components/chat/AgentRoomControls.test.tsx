/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRoomControls } from "@/app/components/chat/AgentRoomControls";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgentRoomControls", () => {
  it("does not delete until the second confirm", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      await Promise.resolve();
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/enabled")) {
        return new Response(JSON.stringify({
          agent: {
            slug: "kit",
            name: "Kit",
            enabled: false,
            tags: [],
            createdBy: "",
            createdAt: 1,
            canMutate: false,
            status: {
              state: "ready",
              since: 1,
              version: "0.0.0",
              lastTurnAt: null,
              lastTurn: null,
              plugins: [],
              published: [],
              skipped: [],
              lastError: null,
              perf: { turns: 0, prompt: 0, completion: 0, errors: 0 },
            },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetch);
    const assign = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { assign } });
    render(<AgentRoomControls slug="kit" />);
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(await screen.findByText("stopped — chat and schedules are paused")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Type the agent ID to continue"), { target: { value: "kit" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete Kit" }));
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/agents/kit"), expect.objectContaining({ method: "DELETE" }));
    fireEvent.click(screen.getByRole("button", { name: "Destroy Kit" }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/chat"));
  });
});
