/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPicker, type ApiClient } from "@/app/components/chat/AgentPicker";

afterEach(() => {
  cleanup();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const EMPTY = "No agent yet — ask your admin to add you to one.";

describe("AgentPicker", () => {
  it("lists agents as cards into chat", async () => {
    const client: ApiClient = vi.fn(async () => json({
      sub: "1",
      email: "ada@example.com",
      role: "member",
      agents: ["kit", "ada"],
    }));
    render(<AgentPicker client={client} />);
    const ada = await screen.findByRole("link", { name: "Ada" });
    const kit = screen.getByRole("link", { name: "Kit" });
    expect(ada.getAttribute("href")).toBe("/chat/ada");
    expect(kit.getAttribute("href")).toBe("/chat/kit");
    expect(ada.querySelector("[aria-hidden]")?.textContent).toBe("A");
    expect(ada.textContent).toContain("ada");
    expect(screen.getByRole("link", { name: "gantree home" }).querySelector("svg[data-tree-mark]")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Manage agents" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
    expect(client).toHaveBeenCalledWith("/api/auth/me");
  });

  it("falls back to the older cranes list", async () => {
    const client: ApiClient = vi.fn(async () => json({ sub: "1", role: "member", cranes: ["tim"] }));
    render(<AgentPicker client={client} />);
    expect((await screen.findByRole("link", { name: "Tim" })).getAttribute("href")).toBe("/chat/tim");
  });

  it("says when a member has no agent and offers log out", async () => {
    const client: ApiClient = vi.fn(async () => json({ sub: "1", email: "ada@example.com", role: "member", agents: [] }));
    render(<AgentPicker client={client} />);
    expect(await screen.findByText(EMPTY)).toBeTruthy();
    const form = screen.getByRole("button", { name: "Log out" }).closest("form");
    expect(form?.getAttribute("action")).toBe("/api/auth/logout");
    expect(form?.getAttribute("method")).toBe("post");
    expect(screen.queryByRole("link", { name: "Manage agents" })).toBeNull();
  });

  it("links admins and operators at the agent list", async () => {
    const client: ApiClient = vi.fn(async () => json({ sub: "1", role: "admin", agents: [] }));
    const { unmount } = render(<AgentPicker client={client} />);
    expect(await screen.findByText(EMPTY)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Manage agents" }).getAttribute("href")).toBe("/agents");
    unmount();

    const operator: ApiClient = vi.fn(async () => json({ sub: "1", role: "operator", agents: ["kit"] }));
    render(<AgentPicker client={operator} />);
    expect(await screen.findByRole("link", { name: "Manage agents" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Kit" })).toBeTruthy();
  });

  it("keeps log out when the account cannot be read", async () => {
    const client: ApiClient = vi.fn(async () => json({ error: "nope" }, 500));
    render(<AgentPicker client={client} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load agents.");
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
  });
});
