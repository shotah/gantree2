/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileCard, type ApiClient } from "@/app/components/settings/ProfileCard";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "clipboard");
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("ProfileCard", () => {
  it("shows email, role, agents, and a copyable sub", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
    const client: ApiClient = vi.fn(async () => json({
      sub: "118200000000000000001",
      email: "ada@example.com",
      role: "operator",
      agents: ["kit", "ada"],
    }));
    render(<ProfileCard client={client} />);
    expect(await screen.findByText("ada@example.com")).toBeTruthy();
    expect(screen.getByText("operator")).toBeTruthy();
    expect(screen.getByText("kit, ada")).toBeTruthy();
    expect(screen.getByText("118200000000000000001").className).toContain("font-mono");
    fireEvent.click(screen.getByRole("button", { name: "Copy sub" }));
    expect(write).toHaveBeenCalledWith("118200000000000000001");
    expect(await screen.findByRole("button", { name: "Copy sub" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy sub" }).textContent).toBe("Copied");
    const form = screen.getByRole("button", { name: "Log out" }).closest("form");
    expect(form?.getAttribute("action")).toBe("/api/auth/logout");
    expect(form?.getAttribute("method")).toBe("post");
  });

  it("shows None and a dash when email and agents are missing", async () => {
    const client: ApiClient = vi.fn(async () => json({ sub: "1182", role: "member", agents: [] }));
    render(<ProfileCard client={client} />);
    expect(await screen.findByText("—")).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
    expect(screen.getByText("member")).toBeTruthy();
  });

  it("stays quiet when the clipboard refuses", async () => {
    const write = vi.fn().mockRejectedValue(new Error("nope"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
    const client: ApiClient = vi.fn(async () => json({ sub: "1182", email: "ada@example.com", role: "admin", agents: ["kit"] }));
    render(<ProfileCard client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy sub" }));
    expect(write).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Copy sub" }).textContent).toBe("Copy");
  });

  it("still offers log out when the profile cannot be read", async () => {
    const client: ApiClient = vi.fn(async () => json({ error: "nope" }, 500));
    render(<ProfileCard client={client} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load your profile.");
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
  });
});
