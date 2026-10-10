/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { USERS_URL, api, userUrl } from "@/app/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("api", () => {
  it("builds user urls", () => {
    expect(USERS_URL).toBe("/api/users");
    expect(userUrl("bob@example.com")).toBe("/api/users/bob%40example.com");
    expect(userUrl("118212345678901234567:bob@example.com")).toBe("/api/users/118212345678901234567%3Abob%40example.com");
  });

  it("sends same-origin JSON and leaves other people's content-type alone", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await api("/api/users", { method: "POST", body: JSON.stringify({ entry: "a@b.c" }) });
    await api("/api/users", { method: "POST", body: "{}", headers: { "content-type": "text/plain" } });
    await api("/api/users");
    const first = fetchMock.mock.calls[0]?.[1];
    const second = fetchMock.mock.calls[1]?.[1];
    const third = fetchMock.mock.calls[2]?.[1];
    if (!first || !second || !third) {
      throw new Error("fetch was not called");
    }
    expect(first.credentials).toBe("same-origin");
    expect(first.cache).toBe("no-store");
    expect(new Headers(first.headers).get("content-type")).toBe("application/json");
    expect(new Headers(second.headers).get("content-type")).toBe("text/plain");
    expect(new Headers(third.headers).has("content-type")).toBe(false);
  });

  it("returns a 200 as-is and sends a 401 back to /login", async () => {
    const replace = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const ok = await api("/api/users");
    expect(ok.status).toBe(200);
    expect(replace).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    Object.defineProperty(window, "location", { configurable: true, value: { replace } });
    const denied = await api("/api/users");
    expect(denied.status).toBe(401);
    expect(replace).toHaveBeenCalledWith("/login");
  });
});
