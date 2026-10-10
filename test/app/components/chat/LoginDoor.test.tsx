/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginDoor } from "@/app/components/chat/LoginDoor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "userAgent");
  window.history.replaceState({}, "", "/");
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function stubMe(body: unknown, ok = true) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    if (requestUrl(input).includes("/api/auth/me")) {
      return ok ? Response.json(body) : new Response(null, { status: 401 });
    }
    return new Response(null, { status: 404 });
  });
}

describe("LoginDoor", () => {
  it("offers Google when /api/auth/me is signed out", async () => {
    stubMe(null, false);
    const { container } = render(<LoginDoor />);
    const link = await screen.findByRole("link", { name: "Continue with Google" });
    expect(link.getAttribute("href")).toBe("/api/auth/google?next=%2F");
    const door = container.querySelector("[data-shot=login]");
    expect(door?.className.split(/\s+/)).toEqual(expect.arrayContaining([
      "h-full",
      "pt-[env(safe-area-inset-top)]",
      "pb-[env(safe-area-inset-bottom)]",
    ]));
    expect(door?.className.split(/\s+/)).not.toContain("min-h-dvh");
    expect(screen.queryByText(/Add to Home Screen/)).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-tree-mark]")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your agents. Your tools. One door." })).toBeTruthy();
    expect(screen.getByText("Agents you run")).toBeTruthy();
    expect(screen.getByText("Eleven tools")).toBeTruthy();
    expect(screen.getByText("On Cloudflare or at home")).toBeTruthy();
    expect(screen.getByRole("button", { name: "color theme" })).toBeTruthy();
    expect(link.className.split(/\s+/)).toEqual(expect.arrayContaining([
      "w-full",
      "rounded-xl",
      "bg-accent",
      "text-canvas",
      "hover:bg-accent-hover",
    ]));
    expect(link.querySelector("svg")).toBeTruthy();
    const card = container.querySelector("section");
    expect(card?.className).toContain("from-accent-soft");
    expect(card?.className).toContain("rounded-2xl");
  });

  it("tells iPhone Safari to sign in before Add to Home Screen", async () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    });
    stubMe(null, false);
    render(<LoginDoor />);
    expect(await screen.findByRole("link", { name: "Continue with Google" })).toBeTruthy();
    expect(screen.getByText(/Sign in here first, then Share → Add to Home Screen/)).toBeTruthy();
  });

  it("carries ?slug= through the Google start link as /chat/slug", async () => {
    window.history.replaceState({}, "", "/login?slug=kit");
    stubMe(null, false);
    render(<LoginDoor />);
    const link = await screen.findByRole("link", { name: "Continue with Google" });
    expect(link.getAttribute("href")).toBe("/api/auth/google?next=%2Fchat%2Fkit");
  });

  it("shows the door account when /api/auth/me lists agents", async () => {
    stubMe({ sub: "1182", email: "ada@example.com", role: "member", agents: ["kit"] });
    render(<LoginDoor />);
    expect(await screen.findByText(/Signed in as ada@example.com/)).toBeTruthy();
    expect(screen.getByText(/Agents: kit/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Continue with Google" })).toBeNull();
    expect(screen.getByRole("img", { name: "gantree" })).toBeTruthy();
  });
});
