/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsSelect } from "@/app/components/shared/SettingsSelect";

afterEach(() => {
  cleanup();
});

const OPTIONS = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta · 2" },
] as const;

describe("SettingsSelect", () => {
  it("is a labelled native select that hands back the picked id", () => {
    const onChange = vi.fn();
    render(<SettingsSelect label="Thing" value="a" options={OPTIONS} onChange={onChange} />);
    const picker = screen.getByLabelText("Thing") as unknown as HTMLSelectElement;
    expect(picker.tagName).toBe("SELECT");
    expect(picker.value).toBe("a");
    expect([...picker.options].map((o) => o.textContent)).toEqual(["Alpha", "Beta · 2"]);
    fireEvent.change(picker, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("b");
    expect(screen.queryByText(/./, { selector: "p" })).toBeNull();
  });

  it("paints the hint under the control only when given", () => {
    render(<SettingsSelect label="Thing" value="b" options={OPTIONS} onChange={vi.fn()} hint="Why this matters." />);
    expect(screen.getByText("Why this matters.").tagName).toBe("P");
    expect((screen.getByLabelText("Thing") as unknown as HTMLSelectElement).value).toBe("b");
  });
});
