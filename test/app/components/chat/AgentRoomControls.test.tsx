/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRoomControls } from "@/app/components/chat/AgentRoomControls";

const status = {
  state: "ready" as const,
  since: 1,
  version: "0.0.0",
  lastTurnAt: null,
  lastTurn: null,
  plugins: [],
  published: [],
  skipped: [],
  lastError: null,
  perf: { turns: 0, prompt: 0, completion: 0, errors: 0 },
};

function agentCard(enabled: boolean) {
  return {
    agent: {
      slug: "kit",
      name: "Kit",
      enabled,
      tags: [],
      createdBy: "",
      createdAt: 1,
      canMutate: false,
      status,
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgentRoomControls", () => {
  it("does not delete until the second confirm", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/enabled") && (init?.method ?? "GET") === "POST") {
        return new Response(JSON.stringify(agentCard(false)), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetch);
    const assign = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { assign } });
    const onEnabled = vi.fn();
    const { rerender } = render(<AgentRoomControls slug="kit" enabled={true} onEnabled={onEnabled} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await vi.waitFor(() => expect(onEnabled).toHaveBeenCalledWith(false));
    rerender(<AgentRoomControls slug="kit" enabled={false} onEnabled={onEnabled} />);
    expect(screen.getByText("stopped — chat and schedules are paused")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Type the agent ID to continue"), { target: { value: "kit" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete Kit" }));
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/api/agents/kit"), expect.objectContaining({ method: "DELETE" }));
    fireEvent.click(screen.getByRole("button", { name: "Destroy Kit" }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/chat"));
  });

  it("starts a stopped agent", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/enabled") && init?.method === "POST") {
        expect(JSON.parse(typeof init?.body === "string" ? init.body : "{}")).toEqual({ enabled: true });
        return new Response(JSON.stringify(agentCard(true)), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    const onEnabled = vi.fn();
    render(<AgentRoomControls slug="kit" enabled={false} onEnabled={onEnabled} />);
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await vi.waitFor(() => expect(onEnabled).toHaveBeenCalledWith(true));
    expect(fetch).toHaveBeenCalledWith("/api/agents/kit/enabled", expect.objectContaining({ method: "POST" }));
  });

  it("shows Restart for admin when on", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/restart") && init?.method === "POST") {
        return new Response(JSON.stringify(status), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    render(<AgentRoomControls slug="kit" enabled={true} onEnabled={vi.fn()} canRestart />);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/agents/kit/restart", expect.objectContaining({ method: "POST" })));
  });

  it("hides Restart without canRestart or when off", () => {
    render(<AgentRoomControls slug="kit" enabled={true} onEnabled={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Restart" })).toBeNull();
    cleanup();
    render(<AgentRoomControls slug="kit" enabled={false} onEnabled={vi.fn()} canRestart />);
    expect(screen.queryByRole("button", { name: "Restart" })).toBeNull();
  });
});
