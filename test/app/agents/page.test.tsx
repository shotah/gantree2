/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AgentsPage, { metadata } from "@/app/agents/page";
import { card, json, session, href } from "../components/agents/fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgentsPage", () => {
  it("titles the board and lists an agent", async () => {
    expect(metadata.title).toBe("Agents — gantree");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      await Promise.resolve();
      const url = href(input);
      if (url === "/api/auth/me") {
        return json(200, session("admin"));
      }
      if (url === "/api/agents") {
        return json(200, { agents: [card()] });
      }
      return json(500, { error: url });
    }));
    render(<AgentsPage />);
    expect(await screen.findByRole("heading", { name: "Kit" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
  });
});
