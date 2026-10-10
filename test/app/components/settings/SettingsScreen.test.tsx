/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsScreen, type ApiClient } from "@/app/components/settings/SettingsScreen";

/** The URL a fetch-shaped mock was called with, whatever form the caller used. */
function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.cookie = "gantree.landing=; Path=/; Max-Age=0";
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
  it("shows theme and font to a member in a fold that collapses", async () => {
    render(<SettingsScreen client={clientFor("member")} />);
    const looks = await screen.findByRole("region", { name: "Appearance" });
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByText("Theme and type size for this browser.")).toBeTruthy();
    expect(within(looks).getByRole("heading", { name: "Theme" })).toBeTruthy();
    expect(within(looks).getByRole("radiogroup", { name: "Theme" })).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(15);
    // One dropdown in the hero; the gallery is the picker inside the fold.
    expect(screen.getAllByRole("button", { name: "color theme" })).toHaveLength(1);
    expect(within(looks).getByLabelText("Font size")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Profile" }).getAttribute("href")).toBe("/profile");
    expect(screen.getByRole("link", { name: "Agents" }).getAttribute("href")).toBe("/agents");
    expect(screen.queryByRole("link", { name: "Users" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Spend" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Who can be here" })).toBeNull();
    // Members already land in chat; the Entry fold is for staff.
    expect(screen.queryByRole("region", { name: "Entry" })).toBeNull();

    const head = within(looks).getByRole("button", { name: "Appearance" });
    expect(head.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("radiogroup", { name: "Theme" })).toBeNull();
  });

  it("explains locked environment rows to an admin behind a closed fold, and links to users", async () => {
    render(<SettingsScreen client={clientFor("admin", ["kit"])} />);
    const who = await screen.findByRole("region", { name: "Who can be here" });
    expect(who.textContent).not.toContain("stay locked");
    fireEvent.click(within(who).getByRole("button", { name: "Who can be here" }));
    expect(who.textContent).toContain("stay locked");
    expect(who.textContent).toContain("row on Users");
    expect(screen.getByText("admin").className).toContain("text-ok");
    expect(screen.getByText("operator").className).toContain("text-info");
    expect(screen.getByText("member").className).toContain("text-mark");
    expect(screen.getByRole("link", { name: "Open users" }).getAttribute("href")).toBe("/users");
    expect(screen.getByRole("link", { name: "Users" }).getAttribute("href")).toBe("/users");
    const spend = screen.getByRole("region", { name: "Spend" });
    expect(within(spend).getByRole("group", { name: "Spend window" })).toBeTruthy();
    expect(await screen.findByText("No usage in this window.")).toBeTruthy();
  });

  it("shows spend to an operator and hides the users fold", async () => {
    const client = clientFor("operator", ["kit"]);
    render(<SettingsScreen client={client} />);
    expect(await screen.findByRole("region", { name: "Spend" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Who can be here" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Users" })).toBeNull();
    await waitFor(() => {
      const urls = vi.mocked(client).mock.calls.map((call) => urlOf(call[0]));
      expect(urls.some((url) => url.includes("agent=kit"))).toBe(true);
    });
  });

  it("lets staff choose to land in chat, through the landing cookie", async () => {
    render(<SettingsScreen client={clientFor("admin")} />);
    const entry = await screen.findByRole("region", { name: "Entry" });
    expect(within(entry).getByText("console")).toBeTruthy();
    const box = within(entry).getByLabelText<HTMLInputElement>("Open chat on entry");
    expect(box.checked).toBe(false);
    expect(entry.textContent).toContain("opens the console");
    fireEvent.click(box);
    expect(document.cookie).toContain("gantree.landing=chat");
    expect(box.checked).toBe(true);
    expect(within(entry).getByText("chat")).toBeTruthy();
    expect(entry.textContent).toContain("opens your chat");
    fireEvent.click(box);
    expect(document.cookie).not.toContain("gantree.landing=chat");
    expect(box.checked).toBe(false);
  });

  it("reads a pinned room from the cookie", async () => {
    document.cookie = "gantree.landing=chat%3Akit; Path=/";
    render(<SettingsScreen client={clientFor("operator", ["kit"])} />);
    const entry = await screen.findByRole("region", { name: "Entry" });
    expect(within(entry).getByLabelText<HTMLInputElement>("Open chat on entry").checked).toBe(true);
    expect(entry.textContent).toContain("the chat with kit");
  });

  it("keeps appearance when the account cannot be read", async () => {
    const client: ApiClient = vi.fn(async () => json({ error: "nope" }, 500));
    render(<SettingsScreen client={client} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load your account.");
    expect(screen.getByRole("region", { name: "Appearance" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Spend" })).toBeNull();
  });
});
