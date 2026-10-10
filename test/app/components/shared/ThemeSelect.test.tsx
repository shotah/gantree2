/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeSelect } from "@/app/components/shared/ThemeSelect";
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
