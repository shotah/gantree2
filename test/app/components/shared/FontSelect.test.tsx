/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FontSelect } from "@/app/components/shared/FontSelect";
import { applyFont } from "@/app/lib/font";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-font");
  window.localStorage.removeItem("gantree.font");
});

describe("FontSelect", () => {
  it("is a dropdown like the other Settings picks, Small by default", () => {
    render(<FontSelect />);
    const picker = screen.getByLabelText("Font size") as unknown as HTMLSelectElement;
    expect(picker.tagName).toBe("SELECT");
    expect(picker.value).toBe("sm");
    expect([...picker.options].map((o) => o.textContent)).toEqual(["Small", "Medium", "Large", "Extra large"]);
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("picks a size onto the document and remembers it", () => {
    render(<FontSelect />);
    const picker = screen.getByLabelText("Font size") as unknown as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: "xl" } });
    expect(picker.value).toBe("xl");
    expect(document.documentElement.getAttribute("data-font")).toBe("xl");
    expect(localStorage.getItem("gantree.font")).toBe("xl");
  });

  it("follows a size applied from outside (query string, sibling tab)", () => {
    render(<FontSelect />);
    act(() => applyFont("lg"));
    expect((screen.getByLabelText("Font size") as unknown as HTMLSelectElement).value).toBe("lg");
    act(() => {
      window.localStorage.setItem("gantree.font", "md");
      window.dispatchEvent(new StorageEvent("storage", { key: "gantree.font", newValue: "md" }));
    });
    expect((screen.getByLabelText("Font size") as unknown as HTMLSelectElement).value).toBe("md");
    expect(document.documentElement.getAttribute("data-font")).toBe("md");
  });
});
