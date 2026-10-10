/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProfilePage, { metadata } from "@/app/profile/page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("profile page", () => {
  it("renders the profile card", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      sub: "1182",
      email: "ada@example.com",
      role: "admin",
      agents: ["kit"],
    })));
    render(<ProfilePage />);
    expect(metadata.title).toBe("Profile — gantree");
    expect(await screen.findByRole("heading", { name: "Profile" })).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
  });
});
