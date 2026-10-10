/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusFold } from "@/app/components/agents/StatusFold";
import type { ApiClient } from "@/app/lib/agentsHttp";
import { CONTAINER, STATUS, buttonOf, json, textBody } from "./fixtures";

afterEach(() => {
  cleanup();
});

describe("StatusFold", () => {
  it("lists published and skipped tools and runs container actions", async () => {
    const onContainer = vi.fn();
    const client: ApiClient = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const body = JSON.parse(textBody(init?.body)) as { action: string };
      return json(200, { ...CONTAINER, state: body.action === "stop" ? "stopped" : "running" });
    });
    render(
      <StatusFold
        slug="kit"
        status={{ ...STATUS, skipped: [{ name: "cast", reason: "home" }], since: Date.now() - 5_000 }}
        container={{ ...CONTAINER, lastError: "old" }}
        canMutate
        client={client}
        onContainer={onContainer}
      />,
    );
    expect(screen.getByText("maps")).toBeTruthy();
    expect(screen.getByText("cast: home")).toBeTruthy();
    expect(screen.getByText("old")).toBeTruthy();
    expect(screen.getByText(/since 5s ago/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "stop container" }));
    await vi.waitFor(() => expect(onContainer).toHaveBeenCalledWith(expect.objectContaining({ state: "stopped" })));
    fireEvent.click(screen.getByRole("button", { name: "start container" }));
    await vi.waitFor(() => expect(buttonOf(screen.getByRole("button", { name: "start container" })).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "recreate container" }));
    await vi.waitFor(() => expect(client).toHaveBeenCalledTimes(3));
  });

  it("shows an empty harness and hides controls when looking only", () => {
    render(
      <StatusFold
        slug="kit"
        status={{ ...STATUS, published: [], skipped: [], lastTurn: null, since: null }}
        container={null}
        canMutate={false}
        client={vi.fn()}
        onContainer={vi.fn()}
      />,
    );
    expect(screen.getByText("Nothing published.")).toBeTruthy();
    expect(screen.getByText("Nothing skipped.")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "start container" })).toBeNull();
  });

  it("says when the harness has not reported and when an action fails", async () => {
    const client: ApiClient = vi.fn(() => Promise.resolve(json(500, { error: "request_failed" })));
    const { rerender } = render(
      <StatusFold slug="kit" status={null} container={{ ...CONTAINER, state: "unknown", lastError: null }} canMutate client={client} onContainer={vi.fn()} />,
    );
    expect(screen.getByText("Harness has not reported yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "start container" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not reach agents. Try again.");
    rerender(
      <StatusFold slug="kit" status={null} container={null} canMutate={false} client={client} onContainer={vi.fn()} />,
    );
    expect(screen.getAllByText("unknown").length).toBeGreaterThan(0);
  });
});
