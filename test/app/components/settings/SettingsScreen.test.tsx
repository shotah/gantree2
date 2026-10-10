/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsScreen, type ApiClient } from "@/app/components/settings/SettingsScreen";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-font");
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function clientFor(role: string, agents: string[] = []): ApiClient {
  return vi.fn(async (input) => {
    const url = String(input);
    if (url.includes("/api/auth/me")) {
      return json({ sub: "1", email: "ada@example.com", role, agents });
    }
    return json({ samples: [] });
  });
}

describe("SettingsScreen", () => {
  it("shows theme and font to a member", async () => {
    render(<SettingsScreen client={clientFor("member")} />);
    expect(await screen.findByRole("heading", { name: "Appearance" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "color theme" })).toBeTruthy();
    expect(screen.getByLabelText("Font size")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Spend" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Who can be here" })).toBeNull();
  });

  it("explains locked environment rows to an admin and links to users", async () => {
    render(<SettingsScreen client={clientFor("admin", ["kit"])} />);
    const who = await screen.findByRole("region", { name: "Who can be here" });
    expect(who.textContent).toContain("stay locked");
    expect(who.textContent).toContain("row on Users");
    expect(screen.getByRole("link", { name: "Open users" }).getAttribute("href")).toBe("/users");
    expect(await screen.findByRole("heading", { name: "Spend" })).toBeTruthy();
    expect(await screen.findByText("No usage in this window.")).toBeTruthy();
  });

  it("shows spend to an operator and hides the users card", async () => {
    const client = clientFor("operator", ["kit"]);
    render(<SettingsScreen client={client} />);
    expect(await screen.findByRole("heading", { name: "Spend" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Who can be here" })).toBeNull();
    const urls = vi.mocked(client).mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("agent=kit"))).toBe(true);
  });

  it("keeps appearance when the account cannot be read", async () => {
    const client: ApiClient = vi.fn(async () => json({ error: "nope" }, 500));
    render(<SettingsScreen client={client} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load your account.");
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Spend" })).toBeNull();
  });
});
