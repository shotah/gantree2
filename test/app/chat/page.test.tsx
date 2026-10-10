/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatPage, { metadata } from "@/app/chat/page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("chat index", () => {
  it("renders the picker", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      sub: "1",
      email: "ada@example.com",
      role: "member",
      agents: ["kit"],
    })));
    render(<ChatPage />);
    expect(metadata.title).toBe("Chat — gantree");
    expect((await screen.findByRole("link", { name: "Kit" })).getAttribute("href")).toBe("/chat/kit");
  });
});
