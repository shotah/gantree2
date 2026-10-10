/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Backdrop } from "@/app/components/chat/Backdrop";

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:wall") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function stubFetch(status: number) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    calls.push(requestUrl(input));
    // Bytes, not a jsdom Blob: Node's Response cannot stream jsdom's Blob.
    return status === 200
      ? new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status, headers: { "Content-Type": "image/jpeg" } })
      : new Response(null, { status });
  });
  return calls;
}

describe("Backdrop", () => {
  it("paints nothing and fetches nothing without a slug", async () => {
    const calls = stubFetch(200);
    const { container } = render(<Backdrop slug="" rev={0} />);
    await Promise.resolve();
    expect(container.innerHTML).toBe("");
    expect(calls).toEqual([]);
  });

  it("fetches the rev-busted path and covers the parent when the room has one", async () => {
    const calls = stubFetch(200);
    const { container } = render(<Backdrop slug="kit" rev={42} secret="s" />);
    await waitFor(() => expect(container.querySelector("img")).toBeTruthy());
    expect(calls).toEqual(["/api/chat/backdrop?slug=kit&v=42&secret=s"]);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("blob:wall");
    expect(img.className).toContain("object-cover");
    const wrap = img.parentElement as HTMLElement;
    expect(wrap.getAttribute("aria-hidden")).toBe("true");
    expect(wrap.className).toContain("absolute inset-0");
    expect(wrap.className).toContain("pointer-events-none");
  });

  it("paints nothing when the room has no backdrop (404 after clear)", async () => {
    const calls = stubFetch(404);
    const { container } = render(<Backdrop slug="kit" rev={0} />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toBe("/api/chat/backdrop?slug=kit");
    expect(container.innerHTML).toBe("");
  });
});
