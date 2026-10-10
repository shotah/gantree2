/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstallApp } from "@/app/components/chat/InstallApp";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.removeItem("gantree.install");
  Reflect.deleteProperty(window, "matchMedia");
  Reflect.deleteProperty(navigator, "userAgent");
});

function stubIphone() {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  });
}

function firePrompt(prompt: () => Promise<unknown>) {
  const ev = new Event("beforeinstallprompt", { cancelable: true, bubbles: true });
  Object.assign(ev, { prompt });
  act(() => {
    window.dispatchEvent(ev);
  });
}

describe("InstallApp", () => {
  it("points at Chrome's menu until beforeinstallprompt fires", () => {
    render(<InstallApp placement="block" />);
    expect(screen.getByText(/Cast, save and share/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install app" })).toBeNull();
  });

  it("puts sign-in before Add to Home Screen on an iPhone that still needs Google", () => {
    stubIphone();
    render(<InstallApp placement="block" signInFirst />);
    expect(screen.getByText("Sign in first, then Share → Add to Home Screen")).toBeTruthy();
    expect(screen.queryByText(/Cast, save and share/)).toBeNull();
  });

  it("keeps the plain Share hint once the iPhone is signed in", () => {
    stubIphone();
    render(<InstallApp placement="block" />);
    expect(screen.getByText("Share → Add to Home Screen")).toBeTruthy();
  });

  it("prompts from the header once Chrome offers install", async () => {
    const prompt = vi.fn().mockResolvedValue({ outcome: "accepted" });
    render(<InstallApp placement="header" />);
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    firePrompt(prompt);
    expect(screen.getByRole("button", { name: "Install" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install" }));
    });
    expect(prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("lets you dismiss the header hint without losing Install in settings", () => {
    const prompt = vi.fn().mockResolvedValue({ outcome: "accepted" });
    render(
      <>
        <InstallApp placement="header" />
        <InstallApp placement="block" />
      </>,
    );
    firePrompt(prompt);
    expect(screen.getByRole("button", { name: "Install" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss install" }));
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    expect(screen.getByRole("button", { name: "Install app" })).toBeTruthy();
    expect(window.localStorage.getItem("gantree.install")).toBe("off");
  });

  it("does not show the header hint after it was dismissed", () => {
    window.localStorage.setItem("gantree.install", "off");
    const prompt = vi.fn().mockResolvedValue({ outcome: "accepted" });
    render(<InstallApp placement="header" />);
    firePrompt(prompt);
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss install" })).toBeNull();
  });

  it("hides the control once the page is already a standalone app", () => {
    window.matchMedia = (q: string) => ({
      matches: q === "(display-mode: standalone)",
      media: q,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    render(<InstallApp placement="block" />);
    expect(screen.queryByText(/Cast, save and share/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Install app" })).toBeNull();
  });
});
