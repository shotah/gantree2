/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import {
  applyFont,
  DEFAULT_FONT,
  FONT_BOOT,
  FONTS,
  fontCss,
  fontFromQuery,
  fontOf,
  parseFont,
} from "@/app/lib/font";

afterEach(() => {
  document.documentElement.removeAttribute("data-font");
  window.localStorage.removeItem("gantree.font");
});

describe("font", () => {
  it("falls back to small", () => {
    expect(parseFont(undefined)).toBe(DEFAULT_FONT);
    expect(parseFont("nope")).toBe("sm");
    expect(parseFont("lg")).toBe("lg");
    expect(fontFromQuery("xl")).toBe("xl");
    expect(fontFromQuery("nope")).toBeNull();
    expect(fontFromQuery(null)).toBeNull();
  });

  it("ships Small through Extra large", () => {
    expect(FONTS.map((f) => f.id)).toEqual(["sm", "md", "lg", "xl"]);
    expect(FONTS.map((f) => f.label)).toEqual(["Small", "Medium", "Large", "Extra large"]);
    const css = fontCss();
    expect(css).toContain(':root,[data-font="sm"]');
    expect(css).toContain("--chat-font:0.875rem");
    expect(css).toContain("--chat-font:1.5rem");
    expect(css).toContain(".text-chat{font-size:var(--chat-font);line-height:1.625}");
    expect(FONT_BOOT).toContain("gantree.font");
    expect(fontOf("sm").size).toBe("0.875rem");
    expect(fontOf("md").size).toBe("1rem");
    expect(fontOf("lg").size).toBe("1.25rem");
    expect(fontOf("xl").size).toBe("1.5rem");
    expect(fontOf("nope" as "sm").id).toBe("sm");
  });

  it("applies a size on the document", () => {
    applyFont("lg");
    expect(document.documentElement.getAttribute("data-font")).toBe("lg");
    expect(localStorage.getItem("gantree.font")).toBe("lg");
    applyFont("lg");
    applyFont("xl");
    expect(document.documentElement.getAttribute("data-font")).toBe("xl");
  });
});
