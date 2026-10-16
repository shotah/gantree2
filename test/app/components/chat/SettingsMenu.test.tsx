/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsMenu } from "@/app/components/chat/SettingsMenu";

beforeEach(() => {
  window.history.pushState({}, "", "/");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    sub: "1",
    email: "ada@example.com",
    role: "member",
    agents: [],
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

describe("SettingsMenu", () => {
  it("keeps children closed until the cog is tapped", () => {
    render(
      <SettingsMenu>
        <p>panel body</p>
      </SettingsMenu>,
    );
    expect(screen.queryByText("panel body")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    expect(screen.getByText("panel body")).toBeTruthy();
  });

  it("closes on Escape and an outside click", () => {
    render(
      <div>
        <p>outside</p>
        <SettingsMenu>
          <span>inside</span>
        </SettingsMenu>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    expect(screen.getByText("inside")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("inside")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(screen.queryByText("inside")).toBeNull();
  });

  it("is a right-hand drawer that scrolls on its own, with a scrim and a close button", () => {
    render(
      <SettingsMenu>
        <span>inside</span>
      </SettingsMenu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog.className).toContain("fixed");
    expect(dialog.className).toContain("right-0");
    expect(dialog.className).toContain("inset-y-0");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(dialog);
    const body = screen.getByText("inside").parentElement;
    expect(body?.className).toContain("overflow-y-auto");

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.queryByText("inside")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    fireEvent.click(screen.getByTestId("settings-scrim"));
    expect(screen.queryByText("inside")).toBeNull();
  });

  it("adds Manage and All agents for an admin on a chat", async () => {
    window.history.pushState({}, "", "/chat/kit");
    const fetchMock = vi.fn(async () => Response.json({
      sub: "1",
      email: "ada@example.com",
      role: "admin",
      agents: ["kit"],
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SettingsMenu><span>inside</span></SettingsMenu>);
    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    const manage = await screen.findByRole("link", { name: "Manage kit" });
    expect(manage.getAttribute("href")).toBe("/agents/kit");
    expect(screen.getByRole("link", { name: "All agents" }).getAttribute("href")).toBe("/agents");
    expect(screen.getByText("inside")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    expect(await screen.findByRole("link", { name: "All agents" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives an operator Manage for their room only", async () => {
    window.history.pushState({}, "", "/chat/kit");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      sub: "1",
      email: "ada@example.com",
      role: "operator",
      agents: ["kit"],
    })));
    render(<SettingsMenu><span>inside</span></SettingsMenu>);
    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    const manage = await screen.findByRole("link", { name: "Manage kit" });
    expect(manage.getAttribute("href")).toBe("/agents/kit");
    expect(screen.queryByRole("link", { name: "All agents" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("shows Manage for a member on their room and hides console rows otherwise", async () => {
    window.history.pushState({}, "", "/chat/kit");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      sub: "1",
      email: "bob@example.com",
      role: "member",
      agents: ["kit"],
    })));
    render(<SettingsMenu><span>inside</span></SettingsMenu>);
    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    const manage = await screen.findByRole("link", { name: "Manage kit" });
    expect(manage.getAttribute("href")).toBe("/agents/kit");
    expect(screen.queryByRole("link", { name: "All agents" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();

    cleanup();
    window.history.pushState({}, "", "/chat/kit");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      sub: "1",
      email: "ada@example.com",
      role: "member",
      agents: [],
    })));
    render(<SettingsMenu><span>inside</span></SettingsMenu>);
    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    expect(await screen.findByText("inside")).toBeTruthy();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Manage kit" })).toBeNull();
    expect(screen.queryByRole("link", { name: "All agents" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();

    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      sub: "1",
      email: "ada@example.com",
      role: "operator",
      agents: ["ada"],
    })));
    render(<SettingsMenu><span>inside</span></SettingsMenu>);
    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    expect(await screen.findByText("inside")).toBeTruthy();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Manage kit" })).toBeNull();
    expect(screen.queryByRole("link", { name: "All agents" })).toBeNull();
  });

  it("shows All agents without Manage when the path is not a chat slug", async () => {
    window.history.pushState({}, "", "/chat/%");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      sub: "1",
      email: "ada@example.com",
      role: "admin",
      agents: [],
    })));
    render(<SettingsMenu><span>inside</span></SettingsMenu>);
    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    expect(await screen.findByRole("link", { name: "All agents" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Manage / })).toBeNull();
  });

  it("shows no rows when /api/auth/me fails", async () => {
    window.history.pushState({}, "", "/chat/kit");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    render(<SettingsMenu><span>inside</span></SettingsMenu>);
    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    expect(await screen.findByText("inside")).toBeTruthy();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByRole("navigation", { name: "Agents" })).toBeNull();
  });
});
