/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AgentPage, { metadata } from "@/app/agents/[slug]/page";
import { MAPS, card, config, json, session, href } from "../../components/agents/fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AgentPage", () => {
  it("titles the dashboard and passes the slug", async () => {
    expect(metadata.title).toBe("Agent — gantree");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      await Promise.resolve();
      const url = href(input);
      if (url === "/api/auth/me") {
        return json(200, session("admin"));
      }
      if (url === "/api/tools") {
        return json(200, { tools: [MAPS] });
      }
      if (url.endsWith("/config")) {
        return json(200, config());
      }
      if (url.endsWith("/users")) {
        return json(200, { users: [] });
      }
      if (url === "/api/agents/ada") {
        return json(200, { agent: card({ slug: "ada", name: "Ada" }) });
      }
      return json(500, { error: url });
    }));
    render(await AgentPage({ params: Promise.resolve({ slug: "ada" }) }));
    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open chat" }).getAttribute("href")).toBe("/chat/ada");
  });
});
