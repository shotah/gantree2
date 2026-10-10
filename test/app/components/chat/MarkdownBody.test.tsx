/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownBody } from "@/app/components/chat/MarkdownBody";

afterEach(() => {
  cleanup();
});

describe("MarkdownBody", () => {
  it("renders emphasis, a list, and a fenced block", () => {
    render(
      <MarkdownBody
        text={"**bold** and `code`\n\n- one\n- two\n\n```\nfn()\n```"}
      />,
    );
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("code").tagName).toBe("CODE");
    expect(screen.getByText("one").tagName).toBe("LI");
    expect(screen.getByText("fn()").closest("pre")).toBeTruthy();
  });

  it("opens links off-origin and ignores raw HTML", () => {
    render(
      <MarkdownBody
        text={"See [NASA](https://www.nasa.gov).\n\n<em>injected</em>"}
      />,
    );
    const link = screen.getByRole("link", { name: "NASA" });
    expect(link.getAttribute("href")).toBe("https://www.nasa.gov");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.queryByText("injected")).toBeNull();
    expect(document.querySelector("em")).toBeNull();
  });

  it("keeps a single newline as a break", () => {
    render(<MarkdownBody text={"line one\nline two"} />);
    expect(screen.getByText(/line one/)).toBeTruthy();
    expect(screen.getByText(/line two/)).toBeTruthy();
    expect(document.querySelector("br")).toBeTruthy();
  });
});
