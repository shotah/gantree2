/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThemeGallery } from "@/app/components/settings/ThemeGallery";
import { THEME_EVENT, THEME_KEY, THEMES, themeOf } from "@/app/lib/theme";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

/** jsdom serializes inline hex colours as `rgb(r, g, b)`. */
function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe("ThemeGallery", () => {
  it("paints fifteen themes in catalog order and rings the live one", () => {
    render(<ThemeGallery />);
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(group.className).toContain("grid-cols-3");
    expect(group.className).toContain("sm:grid-cols-5");
    const radios = screen.getAllByRole("radio");
    expect(radios.map((el) => el.getAttribute("aria-label"))).toEqual(THEMES.map((theme) => theme.label));
    for (const theme of THEMES) {
      const tile = screen.getByRole("radio", { name: theme.label });
      expect(tile.getAttribute("title")).toBe(theme.mood);
      const html = tile.innerHTML;
      expect(html).toContain(rgb(theme.tokens.canvas));
      expect(html).toContain(rgb(theme.tokens.panel));
      expect(html).toContain(rgb(theme.tokens.accent));
      expect(html).toContain(rgb(theme.tokens.fg));
      expect(html).toContain(`color: ${rgb(theme.tokens.body)}`);
    }
    const boom = screen.getByRole("radio", { name: "Boom" });
    expect(boom.getAttribute("aria-checked")).toBe("true");
    expect(boom.className).toContain("ring-accent");
    expect(screen.getByRole("radio", { name: "Paper" }).getAttribute("aria-checked")).toBe("false");
  });

  it("reads data-theme on mount and follows THEME_EVENT", () => {
    document.documentElement.setAttribute("data-theme", "neon");
    render(<ThemeGallery />);
    expect(screen.getByRole("radio", { name: "Neon" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Boom" }).className).not.toContain("ring-accent");

    document.documentElement.setAttribute("data-theme", "flare");
    fireEvent(window, new Event(THEME_EVENT));
    expect(screen.getByRole("radio", { name: "Flare" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Flare" }).className).toContain("ring-accent");
  });

  it("applies a clicked theme and a storage notice from another tab", () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByRole("radio", { name: "Paper" }));
    expect(localStorage.getItem(THEME_KEY)).toBe("paper");
    expect(document.documentElement.getAttribute("data-theme")).toBe("paper");
    expect(screen.getByRole("radio", { name: "Paper" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Paper" }).className).toContain("ring-2");

    fireEvent(window, new StorageEvent("storage", { key: THEME_KEY, newValue: "mist" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("mist");
    expect(screen.getByRole("radio", { name: "Mist" }).getAttribute("aria-checked")).toBe("true");
    expect(themeOf("mist").label).toBe("Mist");
  });
});
