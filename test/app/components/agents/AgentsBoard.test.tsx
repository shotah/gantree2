/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentsBoard, BOARD_POLL_MS } from "@/app/components/agents/AgentsBoard";
import type { ApiClient } from "@/app/lib/agentsHttp";
import { STATUS, card, json, session, href } from "./fixtures";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

function boardClient(role: "admin" | "operator" = "admin", agents = [card()]): ApiClient {
  return vi.fn(async (input: RequestInfo | URL) => {
    await Promise.resolve();
    const url = href(input);
    if (url === "/api/auth/me") {
      return json(200, session(role));
    }
    if (url === "/api/agents") {
      return json(200, { agents });
    }
    return json(500, { error: url });
  });
}

describe("AgentsBoard", () => {
  it("lists agents with chat, manage, and the enabled tool count", async () => {
    const now = Date.now();
    const kit = card({ tags: ["home"], status: { ...STATUS, lastTurnAt: now - 10_000, lastTurn: now - 10_000 } });
    const ada = card({
      slug: "ada",
      name: "Ada",
      tags: [],
      status: {
        ...STATUS,
        state: "needs_keys",
        published: [],
        skipped: [{ name: "maps", reason: "no key" }],
        plugins: [{ name: "maps", state: "skipped", reason: "no key" }],
        lastTurnAt: null,
        lastTurn: null,
      },
    });
    render(<AgentsBoard client={boardClient("admin", [kit, ada])} />);
    const kitCard = await screen.findByRole("listitem", { name: "Kit" });
    expect(within(kitCard).getByText("running")).toBeTruthy();
    expect(within(kitCard).getByText("home")).toBeTruthy();
    expect(within(kitCard).getByText("1 enabled")).toBeTruthy();
    expect(within(kitCard).getByText("10s ago")).toBeTruthy();
    expect(within(kitCard).getByRole("link", { name: "Open chat" }).getAttribute("href")).toBe("/chat/kit");
    expect(within(kitCard).getByRole("link", { name: "Manage" }).getAttribute("href")).toBe("/agents/kit");

    const adaCard = screen.getByRole("listitem", { name: "Ada" });
    expect(within(adaCard).getByText("running")).toBeTruthy();
    // Skipped tools are not flagged: the board counts what is enabled, nothing else.
    expect(within(adaCard).getByText("0 enabled")).toBeTruthy();
    expect(within(adaCard).queryByText(/skipped/)).toBeNull();
    expect(within(adaCard).getByText("—")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Users" }).getAttribute("href")).toBe("/users");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    expect(screen.getByRole("link", { name: "New agent" }).getAttribute("href")).toBe("/agents/new");
    expect(screen.getByRole("heading", { name: "Agents" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Board" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "gantree home" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("list", { name: "Agents" }).className).toContain("lg:grid-cols-3");
    const avatar = kitCard.querySelector(".from-accent");
    expect(avatar?.textContent).toBe("K");
    expect(avatar?.className).toContain("to-mark");
    expect(within(kitCard).getByText("running").closest("p")?.className).toContain("bg-ok/15");
    expect(within(adaCard).getByText("running").closest("p")?.className).toContain("bg-ok/15");
    expect(within(kitCard).getByText("home").className).toContain("bg-accent-soft");
    expect(within(kitCard).getByText("Tools").className).toContain("uppercase");
    expect(within(kitCard).getByRole("link", { name: "Open chat" }).className).toContain("rounded-xl");
    expect(within(kitCard).getByRole("link", { name: "Manage" }).className).toContain("border-line");
  });

  it("shows stopped when the card is disabled even if status is ready", async () => {
    const halted = card({ enabled: false, status: { ...STATUS, state: "ready" } });
    render(<AgentsBoard client={boardClient("admin", [halted])} />);
    const tile = await screen.findByRole("listitem", { name: "Kit" });
    expect(within(tile).getByText("stopped")).toBeTruthy();
    expect(within(tile).queryByText("running")).toBeNull();
    expect(within(tile).getByText("stopped").closest("p")?.className).toContain("bg-track");
    expect(within(tile).getByText("stopped").closest("p")?.className).not.toContain("bg-ok/15");
  });

  it("offers an admin an empty-state create link and an operator a plain sentence", async () => {
    const { rerender } = render(<AgentsBoard client={boardClient("admin", [])} />);
    expect(await screen.findByRole("link", { name: "Create your first agent" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create your first agent" }).getAttribute("href")).toBe("/agents/new");

    rerender(<AgentsBoard client={boardClient("operator", [])} />);
    expect(await screen.findByText("No agents on your row.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Users" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Create your first agent" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("says when the list is forbidden and when the request fails", async () => {
    const denied: ApiClient = vi.fn(() => Promise.resolve(json(403, { error: "forbidden" })));
    const { rerender } = render(<AgentsBoard client={denied} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Only an admin can open agents.");
    expect(screen.queryByRole("link", { name: "Create your first agent" })).toBeNull();

    const down: ApiClient = vi.fn(() => {
      throw new Error("offline");
    });
    rerender(<AgentsBoard client={down} />);
    expect(await screen.findByText("Could not reach agents. Try again.")).toBeTruthy();
    expect(screen.queryByText("Only an admin can open agents.")).toBeNull();
  });

  it("polls every 10 seconds while the tab is visible and waits while it is hidden", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let agents = [card()];
    let lists = 0;
    const client: ApiClient = vi.fn(async (input: RequestInfo | URL) => {
      await Promise.resolve();
      const url = href(input);
      if (url === "/api/auth/me") {
        return json(200, session("admin"));
      }
      lists += 1;
      return json(200, { agents });
    });
    render(<AgentsBoard client={client} />);
    expect(await screen.findByRole("heading", { name: "Kit" })).toBeTruthy();
    expect(lists).toBe(1);
    agents = [card({ name: "Kitty" })];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    });
    expect(await screen.findByRole("heading", { name: "Kitty" })).toBeTruthy();
    expect(lists).toBe(2);

    let hidden = true;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => hidden ? "hidden" : "visible" });
    const quiet = boardClient("admin", [card()]);
    cleanup();
    render(<AgentsBoard client={quiet} />);
    expect(screen.getByText("Loading agents.")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_POLL_MS);
    });
    expect(quiet).not.toHaveBeenCalled();
    hidden = false;
    fireEvent(document, new Event("visibilitychange"));
    expect(await screen.findByRole("heading", { name: "Kit" })).toBeTruthy();
  });

  it("ignores a response that lands after unmount", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client: ApiClient = vi.fn(async (input: RequestInfo | URL) => {
      await Promise.resolve();
      await gate;
      const url = href(input);
      if (url === "/api/auth/me") {
        return json(200, session("admin"));
      }
      return json(200, { agents: [card()] });
    });
    const { unmount } = render(<AgentsBoard client={client} />);
    unmount();
    release();
    await act(async () => {
      await gate;
    });
    expect(screen.queryByRole("heading", { name: "Kit" })).toBeNull();
  });
});
