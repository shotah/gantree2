/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dayCellClass, GoalsButton, GoalsSheet, weekLabel } from "@/app/components/chat/GoalsBoard";
import { SAMPLE_AIM_LINKS, SAMPLE_AIMS } from "@/app/lib/samples";

afterEach(() => {
  cleanup();
});

describe("GoalsButton", () => {
  it("is nothing on an empty board; the badge is unseen changes, not the board size", () => {
    const { container, rerender } = render(<GoalsButton count={0} changes={0} open={false} onToggle={() => {}} />);
    expect(container.innerHTML).toBe("");
    const onToggle = vi.fn();
    rerender(<GoalsButton count={2} changes={0} open={false} onToggle={onToggle} />);
    const quiet = screen.getByRole("button", { name: "goals" });
    expect(quiet.textContent).toBe("");
    fireEvent.click(quiet);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<GoalsButton count={2} changes={1} open={false} onToggle={onToggle} />);
    expect(screen.getByRole("button", { name: "goals (1 changed)" }).textContent).toBe("1");
  });
});

describe("GoalsSheet", () => {
  it("paints each aim: sentence, day grid, the stamp line, and the Phase 1 lines it has", () => {
    render(<GoalsSheet aims={SAMPLE_AIMS} onClose={() => {}} onAsk={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Goals" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "training" })).toBeTruthy();
    expect(screen.getByText("Gym three mornings a week through spring.")).toBeTruthy();
    expect(screen.getByText("30d +1.4 · 7d +6 · streak 2 · asked")).toBeTruthy();
    expect(screen.getByText("slope +0.3/wk · block 4/10 (40%)")).toBeTruthy();
    expect(screen.getByText("slope +0.1/wk · weight r -0.42 (n 8)")).toBeTruthy();
    // Five cells, an eventless day reads as such.
    const grids = screen.getAllByRole("list", { name: "day scores" });
    expect(grids[0]?.querySelectorAll("li")).toHaveLength(5);
    expect(screen.getAllByLabelText(/no event$/u).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Fri \+3$/u)).toBeTruthy();
  });

  it("paints the week strip per aim and the cross-aim lines under the board, only when sent", () => {
    const { rerender } = render(<GoalsSheet aims={SAMPLE_AIMS} links={SAMPLE_AIM_LINKS} onClose={() => {}} onAsk={() => {}} />);
    const strips = screen.getAllByRole("list", { name: "week means" });
    expect(strips).toHaveLength(2);
    expect(strips[0]?.querySelectorAll("li")).toHaveLength(9);
    expect(screen.getByLabelText(/^week of .* -0\.4$/u)).toBeTruthy();
    expect(screen.getByRole("list", { name: "between aims" }).textContent).toBe("training → next-day weight r +0.38 (n 12)");
    expect(weekLabel({ start: "2026-09-20", mean: 1.4, up: 4, against: 1, metrics: [] })).toMatch(/^week of .*20 \+1\.4$/u);

    const bare = SAMPLE_AIMS.map(({ weeks: _weeks, ...rest }) => rest);
    rerender(<GoalsSheet aims={bare} onClose={() => {}} onAsk={() => {}} />);
    expect(screen.queryByRole("list", { name: "week means" })).toBeNull();
    expect(screen.queryByRole("list", { name: "between aims" })).toBeNull();
  });

  it("every button is a /aims turn and closes the sheet", () => {
    const onAsk = vi.fn<(command: string) => void>();
    const onClose = vi.fn();
    render(<GoalsSheet aims={SAMPLE_AIMS} onClose={onClose} onAsk={onAsk} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask the agent about training" }));
    fireEvent.click(screen.getByRole("button", { name: "Full report" }));
    fireEvent.click(screen.getByRole("button", { name: "Rubric" }));
    expect(onAsk.mock.calls.map((c) => c[0])).toEqual(["/aims training", "/aims", "/aims rubric"]);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("closes on Escape, the scrim, and the ×; says so when the board is empty", () => {
    const onClose = vi.fn();
    render(<GoalsSheet aims={[]} onClose={onClose} onAsk={() => {}} />);
    expect(screen.getByText("No aims on the board.")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("goals-scrim"));
    fireEvent.click(screen.getByRole("button", { name: "Close goals" }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("paints sign as hue and weight as magnitude; an eventless zero is an outline", () => {
    expect(dayCellClass({ day: "d", score: 0, events: [] })).toContain("border-line");
    expect(dayCellClass({ day: "d", score: 0, events: [1] })).toBe("bg-track");
    expect(dayCellClass({ day: "d", score: 3, events: [1] })).toBe("bg-ok");
    expect(dayCellClass({ day: "d", score: 1, events: [1] })).toContain("bg-ok opacity-45");
    expect(dayCellClass({ day: "d", score: -3, events: [1] })).toBe("bg-danger");
    expect(dayCellClass({ day: "d", score: -2, events: [1] })).toContain("bg-danger opacity-75");
  });
});
