/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Brand, PageHeader } from "@/app/components/shared/PageHeader";
import { TreeMark } from "@/app/components/shared/TreeMark";

afterEach(() => {
  cleanup();
});

describe("TreeMark", () => {
  it("paints the tree in currentColor and the orange in the accent", () => {
    const { container } = render(<TreeMark className="h-5 w-5" />);
    const svg = container.querySelector("svg[data-tree-mark]");
    expect(svg?.getAttribute("class")).toBe("h-5 w-5");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.querySelector("g")?.getAttribute("fill")).toBe("currentColor");
    expect(svg?.querySelector("circle")?.getAttribute("fill")).toBe("var(--accent)");
    expect(svg?.querySelector("path")?.getAttribute("d")?.startsWith("M7057")).toBe(true);
  });

  it("is an image when titled", () => {
    render(<TreeMark title="gantree" />);
    expect(screen.getByRole("img", { name: "gantree" })).toBeTruthy();
  });
});

describe("Brand", () => {
  it("links home with the mark and the wordmark", () => {
    render(<Brand />);
    const link = screen.getByRole("link", { name: "gantree home" });
    expect(link.getAttribute("href")).toBe("/");
    expect(link.querySelector("svg[data-tree-mark]")).toBeTruthy();
    expect(link.textContent).toBe("gantree");
  });
});

describe("PageHeader", () => {
  it("shows brand, crumb, title, blurb, nav, and the theme picker", () => {
    render(
      <PageHeader
        title="Kit"
        blurb="One agent."
        crumb={{ href: "/agents", label: "Agents" }}
        nav={[{ href: "/users", label: "Users" }, { href: "/settings", label: "Settings" }]}
        aside={<a href="/chat/kit">Open chat</a>}
      >
        <p>tags</p>
      </PageHeader>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Kit");
    expect(screen.getByText("One agent.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Agents" }).getAttribute("href")).toBe("/agents");
    const nav = screen.getByRole("navigation", { name: "Board" });
    expect(nav.querySelectorAll("a").length).toBe(2);
    expect(screen.getByRole("button", { name: "color theme" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open chat" })).toBeTruthy();
    expect(screen.getByText("tags")).toBeTruthy();
  });

  it("does not clip the theme list: the band is not overflow-hidden and hangs the list from the end edge", () => {
    render(<PageHeader title="Agents" />);
    const band = screen.getByRole("banner");
    expect(band.className).not.toContain("overflow-hidden");
    expect(band.querySelector("[aria-hidden].overflow-hidden")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "color theme" }));
    expect(screen.getByRole("listbox").getAttribute("data-align")).toBe("end");
  });

  it("can drop the theme picker and the nav", () => {
    render(<PageHeader title="Profile" theme={false} />);
    expect(screen.queryByRole("button", { name: "color theme" })).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
