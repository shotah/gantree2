/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Fold, FoldAllButton, FoldGroup } from "@/app/components/agents/Fold";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function Box({ title, start }: { title: string; start: boolean }) {
  const [open, setOpen] = useState(start);
  return <Fold title={title} open={open} onOpen={setOpen}><p>{`${title} body`}</p></Fold>;
}

describe("FoldGroup", () => {
  it("shuts and opens every fold from one button, and leaves single folds free in between", () => {
    render(
      <FoldGroup>
        <FoldAllButton />
        <Box title="A" start />
        <Box title="B" start={false} />
      </FoldGroup>,
    );
    expect(screen.getByText("A body")).toBeTruthy();
    expect(screen.queryByText("B body")).toBeNull();

    const all = screen.getByRole("button", { name: "Collapse all" });
    expect(all.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(all);
    expect(screen.queryByText("A body")).toBeNull();
    expect(screen.queryByText("B body")).toBeNull();
    expect(screen.getByRole("button", { name: "Open all" }).getAttribute("aria-pressed")).toBe("true");

    // A single fold can still be opened on its own after a collapse.
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(screen.getByText("B body")).toBeTruthy();
    expect(screen.queryByText("A body")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open all" }));
    expect(screen.getByText("A body")).toBeTruthy();
    expect(screen.getByText("B body")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse all" })).toBeTruthy();
  });

  it("remembers each fold's state per page, including a collapse-all, and restores it on the next visit", () => {
    const page = () => (
      <FoldGroup id="agent">
        <FoldAllButton />
        <Box title="A" start />
        <Box title="B" start={false} />
      </FoldGroup>
    );
    const first = render(page());
    // Mounting with nothing stored writes the defaults, so a later visit sees the same page.
    expect(JSON.parse(window.localStorage.getItem("gantree.folds.agent") ?? "{}")).toEqual({ A: true, B: false });
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(JSON.parse(window.localStorage.getItem("gantree.folds.agent") ?? "{}")).toEqual({ A: false, B: true });
    first.unmount();

    // Refresh: defaults say A open, B shut; memory says the opposite, and wins.
    const second = render(page());
    expect(screen.queryByText("A body")).toBeNull();
    expect(screen.getByText("B body")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(JSON.parse(window.localStorage.getItem("gantree.folds.agent") ?? "{}")).toEqual({ A: false, B: false });
    second.unmount();

    render(page());
    expect(screen.queryByText("A body")).toBeNull();
    expect(screen.queryByText("B body")).toBeNull();
    // Another page's folds are a different map.
    expect(window.localStorage.getItem("gantree.folds.settings")).toBeNull();
  });

  it("forgets nothing and remembers nothing when the group has no id", () => {
    render(
      <FoldGroup>
        <Box title="A" start />
      </FoldGroup>,
    );
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    expect(window.localStorage.length).toBe(0);
  });

  it("renders no button outside a group, and a lone fold ignores the missing signal", () => {
    render(
      <>
        <FoldAllButton />
        <Box title="Solo" start />
      </>,
    );
    expect(screen.queryByRole("button", { name: /all/ })).toBeNull();
    expect(screen.getByText("Solo body")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Solo" }));
    expect(screen.queryByText("Solo body")).toBeNull();
  });
});
