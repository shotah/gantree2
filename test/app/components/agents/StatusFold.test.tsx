/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusFold } from "@/app/components/agents/StatusFold";
import { STATUS } from "./fixtures";

afterEach(() => {
  cleanup();
});

describe("StatusFold", () => {
  it("lists published and skipped tools", () => {
    render(
      <StatusFold status={{ ...STATUS, skipped: [{ name: "cast", reason: "home" }], since: Date.now() - 5_000 }} />,
    );
    expect(screen.getByText("maps")).toBeTruthy();
    expect(screen.getByText("cast: home")).toBeTruthy();
    expect(screen.getByText(/since 5s ago/)).toBeTruthy();
  });

  it("shows the last error line", () => {
    const { rerender } = render(
      <StatusFold status={{ ...STATUS, harness: "disconnected", lastError: { message: "boot failed", at: "2026-10-11T00:46:23Z" } }} />,
    );
    const why = screen.getByLabelText("Last error");
    expect(why.textContent).toContain("2026-10-11T00:46:23Z");
    expect(why.textContent).toContain("boot failed");
    rerender(<StatusFold status={STATUS} />);
    expect(screen.queryByLabelText("Last error")).toBeNull();
  });

  it("shows an empty catalog", () => {
    render(
      <StatusFold status={{ ...STATUS, published: [], skipped: [], lastTurn: null, since: null }} />,
    );
    expect(screen.getByText("Nothing published.")).toBeTruthy();
    expect(screen.getByText("Nothing skipped.")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("says when status has not arrived", () => {
    render(<StatusFold status={null} />);
    expect(screen.getByText("No status yet.")).toBeTruthy();
  });
});
