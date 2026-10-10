/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIST_WIDTH_CLASS, ThemeSelect } from "@/app/components/shared/ThemeSelect";
import { THEME_KEY } from "@/app/lib/theme";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

const MOOD_LABELS = [
  "Marquee",
  "Lemonade",
  "Neon",
  "Fizz",
  "Rain",
  "Mist",
  "Fuse",
  "Grit",
  "Siren",
  "Flare",
  "Static",
  "Flicker",
];

describe("ThemeSelect", () => {
  it("opens a list wider than its trigger, hung from the start edge or the end edge", () => {
    const { unmount } = render(<ThemeSelect />);
    fireEvent.click(screen.getByRole("button", { name: "color theme" }));
    const list = screen.getByRole("listbox");
    expect(list.className).toContain(LIST_WIDTH_CLASS);
    expect(list.className).not.toContain("inset-x-0");
    expect(list.className).toContain("left-0");
    expect(list.getAttribute("data-align")).toBe("start");
    unmount();

    render(<ThemeSelect align="end" />);
    fireEvent.click(screen.getByRole("button", { name: "color theme" }));
    const right = screen.getByRole("listbox");
    expect(right.className).toContain("right-0");
    expect(right.className).not.toContain("left-0");
    expect(right.getAttribute("data-align")).toBe("end");
  });

  it("groups fifteen themes into Plain and Moods, and tags the agent's row while following", () => {
    const onHumanPick = vi.fn();
    render(<ThemeSelect onHumanPick={onHumanPick} roomTheme="siren" followTheme agentName="Kit" />);
    fireEvent.click(screen.getByRole("button", { name: "color theme" }));

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(15);
    const plain = screen.getByRole("group", { name: "Plain" });
    const moods = screen.getByRole("group", { name: "Moods" });
    expect([...plain.querySelectorAll("[role=option]")].map((el) => el.getAttribute("aria-label"))).toEqual([
      "Boom",
      "Paper",
      "Ink",
    ]);
    expect([...moods.querySelectorAll("[role=option]")].map((el) => el.getAttribute("aria-label"))).toEqual(MOOD_LABELS);
    expect(screen.getByRole("option", { name: "Siren" }).textContent).toContain("Kit");
    expect(screen.getByRole("option", { name: "Boom" }).textContent).not.toContain("Kit");

    fireEvent.click(screen.getByRole("option", { name: "Flare" }));
    expect(onHumanPick).toHaveBeenCalledOnce();
    expect(localStorage.getItem(THEME_KEY)).toBe("flare");
    expect(document.documentElement.getAttribute("data-theme")).toBe("flare");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("hides the tag when follow is off", () => {
    render(<ThemeSelect roomTheme="siren" followTheme={false} />);
    fireEvent.click(screen.getByRole("button", { name: "color theme" }));
    expect(screen.getByRole("option", { name: "Siren" }).textContent).not.toContain("Agent");
  });
});
