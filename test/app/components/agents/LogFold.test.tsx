/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogFold, droppedCount, levelClass } from "@/app/components/agents/LogFold";
import type { ApiClient } from "@/app/lib/agentsHttp";
import type { LogLine } from "@/lib/agents/types";
import { json, href } from "./fixtures";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

function line(over: Partial<LogLine>): LogLine {
  return { seq: 1, at: "12:00", level: "info", message: "hello", ...over };
}

describe("levelClass", () => {
  it("colours levels", () => {
    expect(levelClass("error")).toBe("text-danger");
    expect(levelClass("FATAL")).toBe("text-danger");
    expect(levelClass("panic")).toBe("text-danger");
    expect(levelClass("warn")).toBe("text-mark");
    expect(levelClass("warning")).toBe("text-mark");
    expect(levelClass("debug")).toBe("text-dim");
    expect(levelClass("trace")).toBe("text-dim");
    expect(levelClass("info")).toBe("text-body");
    expect(levelClass("other")).toBe("text-muted");
  });

  it("sums dropped counts", () => {
    expect(droppedCount([line({ dropped: 1 }), line({ seq: 2 })])).toBe(1);
    expect(droppedCount([line({ dropped: 2 })])).toBe(2);
  });
});

describe("LogFold", () => {
  it("tails from the cursor, colours a line, and notes dropped lines", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const pages = [
      { lines: [line({ level: "error", message: "boom", dropped: 2 }), line({ seq: 1, level: "info", message: "dup" })], next: 4 },
      { lines: [line({ seq: 1, message: "dup" }), line({ seq: 5, level: "info", message: "next" })], next: 6 },
    ];
    let n = 0;
    const urls: string[] = [];
    const client: ApiClient = vi.fn(async (input: RequestInfo | URL) => {
      await Promise.resolve();
      urls.push(href(input));
      const page = pages[Math.min(n, pages.length - 1)] ?? pages[0];
      n += 1;
      return json(200, page);
    });
    render(<LogFold slug="kit" client={client} pollMs={3000} />);
    expect(client).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(await screen.findByText("boom")).toBeTruthy();
    expect(screen.getByText("2 lines dropped")).toBeTruthy();
    expect(screen.getByText("boom").closest("li")?.className).toContain("text-danger");
    expect(urls[0]).toBe("/api/agents/kit/log");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(await screen.findByText("next")).toBeTruthy();
    expect(screen.getAllByText("dup")).toHaveLength(1);
    expect(urls[1]).toBe("/api/agents/kit/log?after=4");

    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    const calls = urls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(urls.length).toBe(calls);
  });

  it("pauses while the tab is hidden and shows an error", async () => {
    let hidden = true;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => hidden ? "hidden" : "visible" });
    const client: ApiClient = vi.fn(() => Promise.resolve(json(500, { error: "request_failed" })));
    render(<LogFold slug="kit" client={client} pollMs={30_000} />);
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(screen.getByText("No log lines yet.")).toBeTruthy();
    expect(client).not.toHaveBeenCalled();
    hidden = false;
    fireEvent(document, new Event("visibilitychange"));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not reach agents. Try again.");
  });

  it("notes a single dropped line", async () => {
    const client: ApiClient = vi.fn(() => Promise.resolve(json(200, { lines: [line({ dropped: 1 })], next: 2 })));
    render(<LogFold slug="kit" client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(await screen.findByText("1 line dropped")).toBeTruthy();
  });
});
