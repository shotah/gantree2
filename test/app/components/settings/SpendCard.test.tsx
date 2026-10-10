/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpendCard, type ApiClient } from "@/app/components/settings/SpendCard";
import { SPEND_RATE_KEY } from "@/app/lib/spend";

/** The URL a fetch-shaped mock was called with, whatever form the caller used. */
function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const DAY = 86_400_000;

function samples() {
  const now = Date.now();
  return {
    samples: [
      { id: 1, at: now, agent: "kit", kind: "tokens_prompt", value: 8000 },
      { id: 2, at: now, agent: "kit", kind: "tokens_completion", value: 2000 },
      { id: 3, at: now, agent: "kit", kind: "turn", value: 1 },
      { id: 4, at: now - 8 * DAY, agent: "ada", kind: "tokens_prompt", value: 5000 },
      { id: 5, at: now - 8 * DAY, agent: "ada", kind: "turn", value: 2 },
      { id: 6, at: now - 40 * DAY, agent: "old", kind: "tokens_prompt", value: 424242 },
    ],
  };
}

describe("SpendCard", () => {
  it("rolls today, 7d, and 30d from one samples fetch and prices a pasted rate", async () => {
    localStorage.setItem(SPEND_RATE_KEY, "4");
    const client: ApiClient = vi.fn(async () => json(samples()));
    render(<SpendCard agents={null} client={client} />);

    const kit = await screen.findByRole("listitem", { name: "kit" });
    expect(kit.textContent).toContain("8.00k prompt");
    expect(kit.textContent).toContain("2.00k completion");
    expect(kit.textContent).toContain("$0.04");
    expect(kit.textContent).toContain("1 turn");
    expect(screen.queryByRole("listitem", { name: "ada" })).toBeNull();
    expect(screen.queryByText(/424\.2k/)).toBeNull();

    const first = vi.mocked(client).mock.calls[0]?.[0];
    const url = first === undefined ? "" : urlOf(first);
    expect(url.startsWith("/api/samples?")).toBe(true);
    expect(url).toContain("since=");
    expect(url).not.toContain("agent=");
    expect(screen.getByLabelText<HTMLInputElement>("$ / 1M tokens").value).toBe("4");

    fireEvent.click(screen.getByRole("button", { name: "30d" }));
    expect(screen.getByRole("button", { name: "30d" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("listitem", { name: "ada" }).textContent).toContain("5.00k prompt");
    expect(screen.getByRole("listitem", { name: "ada" }).textContent).toContain("2 turns");
    expect(screen.queryByText(/424\.2k/)).toBeNull();
    expect(client).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("$ / 1M tokens"), { target: { value: "10" } });
    expect(localStorage.getItem(SPEND_RATE_KEY)).toBe("10");
    expect(screen.getByRole("listitem", { name: "kit" }).textContent).toContain("$0.10");

    fireEvent.change(screen.getByLabelText("$ / 1M tokens"), { target: { value: "abc" } });
    expect(localStorage.getItem(SPEND_RATE_KEY)).toBe("10");
    expect(screen.getByRole("listitem", { name: "kit" }).textContent).not.toContain("$");

    fireEvent.change(screen.getByLabelText("$ / 1M tokens"), { target: { value: "" } });
    expect(localStorage.getItem(SPEND_RATE_KEY)).toBeNull();
  });

  it("asks for each operator agent and explains an empty row", async () => {
    const client: ApiClient = vi.fn(async (input) => {
      const url = String(input);
      const agent = new URL(url, "https://g.test").searchParams.get("agent");
      return json({ samples: [{ id: 1, at: Date.now(), agent, kind: "turn", value: 1 }] });
    });
    const { unmount } = render(<SpendCard agents={["kit", "ada"]} client={client} />);
    expect(await screen.findByRole("listitem", { name: "kit" })).toBeTruthy();
    expect(screen.getByRole("listitem", { name: "ada" })).toBeTruthy();
    const urls = vi.mocked(client).mock.calls.map((call) => urlOf(call[0]));
    expect(urls.some((url) => url.includes("agent=kit"))).toBe(true);
    expect(urls.some((url) => url.includes("agent=ada"))).toBe(true);
    unmount();

    const idle: ApiClient = vi.fn(async () => json({ samples: [] }));
    render(<SpendCard agents={[]} client={idle} />);
    expect(screen.getByText("No agents on your row.")).toBeTruthy();
    expect(idle).not.toHaveBeenCalled();
  });

  it("says when samples are forbidden or empty", async () => {
    const denied: ApiClient = vi.fn(async () => json({ error: "forbidden" }, 403));
    const { unmount } = render(<SpendCard agents={null} client={denied} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Spend is for admins and operators.");
    unmount();

    const empty: ApiClient = vi.fn(async () => json({ samples: [] }));
    render(<SpendCard agents={null} client={empty} />);
    expect(await screen.findByText("No usage in this window.")).toBeTruthy();
  });

  it("says when the samples request fails", async () => {
    const client: ApiClient = vi.fn(async () => {
      throw new Error("offline");
    });
    render(<SpendCard agents={null} client={client} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load samples.");
  });
});
