/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage, { metadata } from "@/app/login/page";

const door = vi.hoisted(() => ({ current: null as { label: string; href: string } | null }));

/** The request-reading half lives in `app/login/devDoor.ts` (node-env test); the page only renders what it returns. */
vi.mock("@/app/login/devDoor", () => ({
  devDoorFor: async () => door.current,
}));

afterEach(() => {
  cleanup();
  door.current = null;
});

async function renderLogin(params: Record<string, string | string[] | undefined> = {}) {
  const element = await LoginPage({ searchParams: Promise.resolve(params) });
  return render(element);
}

describe("login page", () => {
  it("renders the hero door", async () => {
    const { container } = await renderLogin();
    expect(metadata.title).toBe("Log in — gantree");
    expect(screen.getByRole("heading", { name: "Your agents. Your tools. One door." })).toBeTruthy();
    expect(screen.getByText("One door. Google account, then the list.")).toBeTruthy();
    expect(screen.getByText("gantree")).toBeTruthy();
    expect(screen.getByRole("img", { name: "gantree" })).toBeTruthy();
    expect(container.querySelector("[data-tree-mark]")).toBeTruthy();
    expect(screen.getByText("Agents you run")).toBeTruthy();
    expect(screen.getByText("Eleven tools")).toBeTruthy();
    expect(screen.getByText("On Cloudflare or at home")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Continue with Google" });
    expect(link.getAttribute("href")).toBe("/api/auth/google");
    expect(link.className.split(/\s+/)).toEqual(expect.arrayContaining([
      "w-full",
      "rounded-xl",
      "bg-accent",
      "text-canvas",
      "hover:bg-accent-hover",
    ]));
    expect(link.querySelector("svg")).toBeTruthy();
    expect(screen.getByText(/Not on the list\?/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "color theme" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    const card = container.querySelector("section");
    expect(card?.className).toContain("rounded-2xl");
    expect(card?.className).toContain("from-accent-soft");
    expect(card?.className).toContain("via-panel");
    expect(card?.className).toContain("border-line");
  });

  it("keeps a safe next path on the Google link", async () => {
    await renderLogin({ next: "/agents" });
    expect(screen.getByRole("link", { name: "Continue with Google" }).getAttribute("href"))
      .toBe("/api/auth/google?next=%2Fagents");
  });

  it("drops an off-site next path", async () => {
    await renderLogin({ next: "//evil.test" });
    expect(screen.getByRole("link", { name: "Continue with Google" }).getAttribute("href"))
      .toBe("/api/auth/google");
  });

  it("ignores a non-string next", async () => {
    await renderLogin({ next: ["/agents", "/chat"] });
    expect(screen.getByRole("link", { name: "Continue with Google" }).getAttribute("href"))
      .toBe("/api/auth/google");
  });

  it("shows the allowlist error", async () => {
    await renderLogin({ error: "not_allowed" });
    expect(screen.getByRole("alert").textContent).toBe("That Google account is not on the list.");
  });

  it("shows a generic error for an unknown code", async () => {
    await renderLogin({ error: "wat" });
    expect(screen.getByRole("alert").textContent).toBe("Sign-in failed. Try again.");
  });

  it("offers the loopback dev door beside Google when the request earns it", async () => {
    door.current = { label: "dev@example.com", href: "/agents" };
    await renderLogin({ next: "/agents" });
    const dev = screen.getByRole("link", { name: /Continue as dev@example.com/ });
    expect(dev.getAttribute("href")).toBe("/agents");
    expect(dev.textContent).toContain("loopback dev");
    expect(dev.className).toContain("text-ok");
    expect(screen.getByRole("link", { name: "Continue with Google" })).toBeTruthy();
  });

  it("has no dev door otherwise", async () => {
    await renderLogin();
    expect(screen.queryByRole("link", { name: /Continue as/ })).toBeNull();
  });
});
