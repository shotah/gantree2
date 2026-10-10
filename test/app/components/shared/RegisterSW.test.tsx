/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegisterSW } from "@/app/components/shared/RegisterSW";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RegisterSW", () => {
  it("registers /sw.js on the origin", () => {
    const register = vi.fn().mockResolvedValue({});
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    render(<RegisterSW />);
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
  });
});
