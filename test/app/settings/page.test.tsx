/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsPage, { metadata } from "@/app/settings/page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("settings page", () => {
  it("renders the settings screen", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      sub: "1",
      email: "ada@example.com",
      role: "member",
      agents: [],
    })));
    render(<SettingsPage />);
    expect(metadata.title).toBe("Settings — gantree");
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Appearance" })).toBeTruthy();
  });
});
