/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentDashboard } from "@/app/components/agents/AgentDashboard";
import type { ApiClient } from "@/app/lib/agentsHttp";
import { MAPS, card, config, json, session, href, areaOf, buttonOf, textBody } from "./fixtures";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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
        return json(200, {
          ...view,
          persona: body.persona ?? view.persona,
        });
      }
      return json(200, view);
    }
    if (url.endsWith("/self")) {
      return json(200, { text: "# SELF.md\n", maxChars: 4096 });
    }
    if (url.endsWith("/log")) {
      return json(200, { lines: [], next: 0 });
    }
    if (url.endsWith("/persona")) {
      if (method === "PUT") {
        const body = JSON.parse(textBody(init?.body)) as { text?: string };
        return json(200, {
          files: [{ name: "PERSONA.md", text: body.text ?? "", updatedAt: 2 }],
          maxChars: 262144,
        });
      }
      return json(200, {
        files: [{ name: "PERSONA.md", text: view.persona, updatedAt: 1 }],
        maxChars: 262144,
      });
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
  it("shows the agent, saves persona, and deletes after the slug is typed", async () => {
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
    expect(screen.getByRole("link", { name: "gantree home" }).getAttribute("href")).toBe("/");
    expect(screen.getByText("home").className).toContain("bg-accent-soft");
    expect(screen.getByRole("link", { name: "Open chat" }).className).toContain("rounded-xl");
    expect(screen.getByRole("region", { name: "Status" }).className).toContain("rounded-2xl");
    const zone = screen.getByRole("region", { name: "Danger zone" });
    expect(zone.className).toContain("border-danger-line");
    expect(zone.className).toContain("bg-danger-soft/40");

    // One header button shuts every fold on the page, wherever its state lives, then offers to open them again.
    const foldHeads = () => ["Status", "Persona", "Self notes", "Keys", "Tools", "Who can chat", "Log"].map((name) => screen.getByRole("button", { name }));
    expect(screen.getByRole("button", { name: "Status" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    for (const head of foldHeads()) {
      expect(head.getAttribute("aria-expanded")).toBe("false");
    }
    fireEvent.click(screen.getByRole("button", { name: "Open all" }));
    for (const head of foldHeads()) {
      expect(head.getAttribute("aria-expanded")).toBe("true");
    }
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.getByRole("button", { name: "Persona" }).getAttribute("aria-expanded")).toBe("false");

    const persona = screen.getByRole("button", { name: "Persona" });
    expect(persona.querySelector("[aria-hidden]")?.className).not.toContain("rotate-180");
    fireEvent.click(persona);
    expect(persona.getAttribute("aria-expanded")).toBe("true");
    expect(persona.querySelector("[aria-hidden]")?.className).toContain("rotate-180");
    fireEvent.change(await screen.findByLabelText("Persona text"), { target: { value: "Be sharp." } });
    fireEvent.click(screen.getByRole("button", { name: "Save persona" }));
    expect(await screen.findByText("Saved.")).toBeTruthy();

    const remove = buttonOf(screen.getByRole("button", { name: "Delete kit" }));
    expect(remove.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type the agent ID to confirm"), { target: { value: "nope" } });
    expect(remove.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Type the agent ID to confirm"), { target: { value: "kit" } });
    expect(remove.disabled).toBe(false);
    fireEvent.click(remove);
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith("/agents"));
  });

  it("has no runtime switch", async () => {
    render(<AgentDashboard slug="kit" client={dashClient()} go={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Kit" })).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("saves persona through the persona route", async () => {
    const client = dashClient();
    render(<AgentDashboard slug="kit" client={client} go={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Kit" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Persona" }));
    const field = areaOf(await screen.findByLabelText("Persona text"));
    expect(field.value).toBe("Be brief.");
    fireEvent.change(field, { target: { value: "Be sharp." } });
    fireEvent.click(screen.getByRole("button", { name: "Save persona" }));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    const puts = vi.mocked(client).mock.calls.filter((call) => call[1]?.method === "PUT" && href(call[0]).endsWith("/persona"));
    expect(JSON.parse(textBody(puts[0]?.[1]?.body))).toEqual({ name: "PERSONA.md", text: "Be sharp." });
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
    fireEvent.change(screen.getByLabelText("Type the agent ID to confirm"), { target: { value: "kit" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete kit" }));
    expect((await screen.findByRole("alert")).textContent).toContain("You do not have access to that.");
    expect(assign).not.toHaveBeenCalled();
    Object.defineProperty(window, "location", { configurable: true, value: previous });
  });

  it("hides changes from an operator", async () => {
    render(<AgentDashboard slug="kit" client={dashClient({ role: "operator", canMutate: false })} />);
    expect(await screen.findByText("Looking only. Changes belong to an admin or this agent's operator.")).toBeTruthy();
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
