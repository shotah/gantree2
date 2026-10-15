/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusFold } from "@/app/components/agents/StatusFold";
import type { ApiClient } from "@/app/lib/agentsHttp";
import { PACKAGE_VERSION } from "@/app/lib/release";
import type { AgentStatus } from "@/lib/agents/types";
import { STATUS, config, href, json } from "./fixtures";

afterEach(() => {
  cleanup();
});

function line(text: string) {
  return (_content: string, node: Element | null) => node?.textContent === text;
}

describe("StatusFold", () => {
  it("shows a ready harness, its version, and the plugin list", () => {
    const status: AgentStatus = {
      ...STATUS,
      since: Date.now() - 5_000,
      plugins: [
        { name: "chat", state: "ready" },
        { name: "math", state: "ready" },
      ],
      published: ["chat", "math"],
    };
    const { container } = render(<StatusFold status={status} />);
    expect(container.querySelector(".bg-ok")).toBeTruthy();
    expect(screen.getAllByText("ready").length).toBeGreaterThan(0);
    expect(screen.queryByText("connected")).toBeNull();
    expect(screen.queryByText("disconnected")).toBeNull();
    expect(screen.getByText(PACKAGE_VERSION)).toBeTruthy();
    expect(screen.getByText(/since 5s ago/)).toBeTruthy();
    expect(screen.getByText(line("ready: chat, math"))).toBeTruthy();
  });

  it("shows needs keys in amber and the skip reasons", () => {
    const { container } = render(
      <StatusFold
        status={{
          ...STATUS,
          state: "needs_keys",
          plugins: [
            { name: "chat", state: "ready" },
            { name: "strava", state: "skipped", reason: "no_key" },
            { name: "garmin", state: "skipped", reason: "disabled" },
          ],
        }}
      />,
    );
    expect(container.querySelector(".bg-amber-500")).toBeTruthy();
    expect(screen.getAllByText("needs keys").length).toBeGreaterThan(0);
    expect(screen.getByText(line("skipped: strava (no key), garmin (off)"))).toBeTruthy();
  });

  it("shows an error in red with the last error line", () => {
    const { container, rerender } = render(
      <StatusFold
        status={{
          ...STATUS,
          state: "error",
          plugins: [{ name: "maps", state: "skipped", reason: "error" }],
          lastError: { message: "boot failed", at: "2026-10-11T00:46:23Z" },
        }}
      />,
    );
    expect(container.querySelector(".bg-danger")).toBeTruthy();
    expect(screen.getAllByText("error").length).toBeGreaterThan(0);
    const why = screen.getByLabelText("Last error");
    expect(why.textContent).toBe("2026-10-11T00:46:23Z boot failed");
    rerender(<StatusFold status={STATUS} />);
    expect(screen.queryByLabelText("Last error")).toBeNull();
  });

  it("shows starting with an empty plugin list", () => {
    const { container } = render(
      <StatusFold
        status={{
          ...STATUS,
          state: "starting",
          plugins: [],
          published: [],
          skipped: [],
          lastTurnAt: null,
          lastTurn: null,
          since: null,
        }}
      />,
    );
    expect(container.querySelector(".bg-faint")).toBeTruthy();
    expect(screen.getAllByText("starting").length).toBeGreaterThan(0);
    expect(screen.getByText(line("ready: —"))).toBeTruthy();
    expect(screen.getByText(line("skipped: —"))).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("says when status has not arrived", () => {
    render(<StatusFold status={null} />);
    expect(screen.getByText("No status yet.")).toBeTruthy();
    expect(screen.getAllByText("unknown").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Restart" })).toBeNull();
  });

  it("turns off and shows the stopped hint", async () => {
    const client: ApiClient = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const url = href(input);
      if (url.endsWith("/enabled") && init?.method === "POST") {
        return json(200, { agent: { slug: "kit", name: "Kit", createdBy: "sub", createdAt: 1, tags: [], enabled: false, status: STATUS, canMutate: true } });
      }
      return json(200, STATUS);
    });
    function Harness() {
      const [enabled, setEnabled] = useState(true);
      return (
        <StatusFold
          slug="kit"
          status={STATUS}
          enabled={enabled}
          client={client}
          onEnabled={setEnabled}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(await screen.findByText("stopped — chat and schedules are paused")).toBeTruthy();
    expect(vi.mocked(client).mock.calls.some((call) => href(call[0]).endsWith("/enabled"))).toBe(true);
  });

  it("shows 48 hours by default and saves idleHours", async () => {
    const seen: unknown[] = [];
    const client: ApiClient = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const url = href(input);
      if (url.endsWith("/config") && init?.method === "PATCH") {
        const raw = init?.body;
        seen.push(typeof raw === "string" ? JSON.parse(raw) as unknown : raw);
        return json(200, config({ idleHours: 12 }));
      }
      return json(200, STATUS);
    });
    function Harness() {
      const [cfg, setCfg] = useState(config());
      return (
        <StatusFold
          slug="kit"
          status={STATUS}
          idleHours={cfg.idleHours}
          canMutate
          client={client}
          onConfig={setCfg}
        />
      );
    }
    render(<Harness />);
    const field = screen.getByLabelText("Stop after");
    expect((field as HTMLInputElement).value).toBe("48");
    fireEvent.change(field, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByDisplayValue("12");
    expect(seen).toEqual([{ idleHours: 12 }]);
  });

  it("does not PATCH idleHours of zero", async () => {
    const client: ApiClient = vi.fn(async () => json(200, STATUS));
    render(
      <StatusFold slug="kit" status={STATUS} canMutate client={client} onConfig={() => undefined} />,
    );
    const field = screen.getByLabelText("Stop after");
    fireEvent.change(field, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(vi.mocked(client).mock.calls.some((call) => href(call[0]).endsWith("/config"))).toBe(false);
  });

  it("restarts the harness and refetches status", async () => {
    const next: AgentStatus = {
      ...STATUS,
      state: "needs_keys",
      plugins: [{ name: "strava", state: "skipped", reason: "no_key" }],
      published: [],
      skipped: [{ name: "strava", reason: "no_key" }],
    };
    const seen: string[] = [];
    const client: ApiClient = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const url = href(input);
      seen.push(`${init?.method ?? "GET"} ${url}`);
      return json(200, next);
    });
    render(<StatusFold slug="kit" status={STATUS} client={client} />);
    expect(screen.getByRole("button", { name: "Restart" })).toBeTruthy();
    expect(screen.getByText("reloads tools, chat stays")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect((await screen.findAllByText("needs keys")).length).toBeGreaterThan(0);
    expect(screen.getByText(line("skipped: strava (no key)"))).toBeTruthy();
    expect(seen).toEqual([
      "POST /api/agents/kit/restart",
      "GET /api/agents/kit/status",
    ]);
  });
});
