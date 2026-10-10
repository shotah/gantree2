/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentDashboard } from "@/app/components/agents/AgentDashboard";
import type { ApiClient } from "@/app/lib/agentsHttp";
import { CONTAINER, MAPS, card, config, json, session, href, buttonOf, textBody } from "./fixtures";

afterEach(() => {
  cleanup();
});

function dashClient(options?: { role?: "admin" | "operator"; canMutate?: boolean; status?: number; failOnce?: boolean }): ApiClient {
  let misses = 0;
  const view = config();
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    await Promise.resolve();
    const url = href(input);
    const method = init?.method ?? "GET";
    if (url === "/api/auth/me") {
      return json(200, session(options?.role ?? "admin"));
    }
    if (url === "/api/tools") {
      return json(200, { tools: [MAPS] });
    }
    if (url.endsWith("/users")) {
      return json(200, { users: [{ email: "ada@example.com" }] });
    }
    if (url.endsWith("/config")) {
      if (method === "PATCH") {
        const body = JSON.parse(textBody(init?.body)) as { persona?: string };
        return json(200, { ...view, persona: body.persona ?? view.persona });
      }
      return json(200, view);
    }
    if (url.endsWith("/container")) {
      return json(200, { ...CONTAINER, state: "stopped" });
    }
    if (method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (url === "/api/agents/kit") {
      if (options?.failOnce && misses === 0) {
        misses += 1;
        return json(500, { error: "request_failed" });
      }
      if (options?.status) {
        return json(options.status, { error: options.status === 404 ? "missing" : "forbidden" });
      }
      return json(200, { agent: card({ canMutate: options?.canMutate ?? true, tags: options?.canMutate === false ? [] : ["home"] }) });
    }
    return json(500, { error: `${method} ${url}` });
  });
}

describe("AgentDashboard", () => {
  it("shows the agent, runs a container action, saves persona, and deletes after the slug is typed", async () => {
    const go = vi.fn();
    const client = dashClient();
    render(<AgentDashboard slug="kit" client={client} go={go} spend={<p>Spend goes here</p>} />);
    expect(screen.getByText("Loading agent.")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Kit" })).toBeTruthy();
    expect(screen.getByText("Spend goes here")).toBeTruthy();
    expect(screen.getByText("home")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open chat" }).getAttribute("href")).toBe("/chat/kit");
    expect(screen.getByRole("link", { name: "Agents" }).getAttribute("href")).toBe("/agents");
    expect(screen.getByText("maps")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "stop container" }));
    expect(await screen.findByText("stopped")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Persona" }));
    fireEvent.change(screen.getByLabelText("Persona text"), { target: { value: "Be sharp." } });
    fireEvent.click(screen.getByRole("button", { name: "Save persona" }));
    expect(await screen.findByText("Saved.")).toBeTruthy();

    const remove = buttonOf(screen.getByRole("button", { name: "Delete kit" }));
    expect(remove.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type the slug to confirm"), { target: { value: "nope" } });
    expect(remove.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type the slug to confirm"), { target: { value: "kit" } });
    expect(remove.disabled).toBe(false);
    fireEvent.click(remove);
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith("/agents"));
  });

  it("stays put when delete fails and assigns the board when no router is passed", async () => {
    const assign = vi.fn();
    const previous = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { assign, replace: vi.fn() } });
    const client: ApiClient = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const url = href(input);
      const method = init?.method ?? "GET";
      if (method === "DELETE") {
        return json(500, { error: "forbidden" });
      }
      return dashClient()(url, init);
    });
    render(<AgentDashboard slug="kit" client={client} />);
    expect(await screen.findByRole("heading", { name: "Kit" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Type the slug to confirm"), { target: { value: "kit" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete kit" }));
    expect((await screen.findByRole("alert")).textContent).toContain("You do not have access to that.");
    expect(assign).not.toHaveBeenCalled();
    Object.defineProperty(window, "location", { configurable: true, value: previous });
  });

  it("hides changes from an operator", async () => {
    render(<AgentDashboard slug="kit" client={dashClient({ role: "operator", canMutate: false })} />);
    expect(await screen.findByText("Looking only. Changes belong to an admin or this agent's operator.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "start container" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Danger zone" })).toBeNull();
  });

  it("explains a missing agent, a forbidden agent, and a failed load that can be retried", async () => {
    const { rerender } = render(<AgentDashboard slug="kit" client={dashClient({ status: 404 })} />);
    expect((await screen.findByRole("alert")).textContent).toContain("That agent is not here.");

    rerender(<AgentDashboard slug="kit" client={dashClient({ status: 403 })} />);
    expect((await screen.findByRole("alert")).textContent).toContain("You do not have access to that.");

    rerender(<AgentDashboard slug="kit" client={dashClient({ failOnce: true })} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not reach agents. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Kit" })).toBeTruthy();
  });
});
