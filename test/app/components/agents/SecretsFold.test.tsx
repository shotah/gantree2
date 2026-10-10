/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecretsFold, cleanSecretKey } from "@/app/components/agents/SecretsFold";
import type { ApiClient } from "@/app/lib/agentsHttp";
import type { AgentConfigView } from "@/lib/agents/types";
import { config, json, href, textBody } from "./fixtures";

afterEach(() => {
  cleanup();
});

describe("cleanSecretKey", () => {
  it("accepts env-style names", () => {
    expect(cleanSecretKey(" MAPS_KEY ")).toBe("MAPS_KEY");
    expect(cleanSecretKey("1NO")).toBeNull();
    expect(cleanSecretKey("has space")).toBeNull();
  });
});

describe("SecretsFold", () => {
  it("adds and removes keys without showing values, and recreates when asked", async () => {
    const seen: AgentConfigView[] = [];
    function Harness({ client }: { client: ApiClient }) {
      const [view, setView] = useState(config({ recreate: true }));
      return (
        <SecretsFold
          slug="kit"
          config={view}
          canMutate
          client={client}
          onConfig={(next) => {
            seen.push(next);
            setView(next);
          }}
        />
      );
    }
    const client: ApiClient = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const url = href(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/container")) {
        return json(200, { state: "running", since: 1, lastError: null, image: null });
      }
      if (method === "GET") {
        return json(200, config({ recreate: false, envKeys: ["LLM_API_KEY"] }));
      }
      const body = JSON.parse(textBody(init?.body)) as { env: Record<string, string | null> };
      const key = Object.keys(body.env)[0] ?? "";
      const envKeys = body.env[key] === null ? [] : ["LLM_API_KEY", key];
      return json(200, config({ envKeys, recreate: true }));
    });
    render(<Harness client={client} />);
    expect(screen.getByText("Keys changed. Recreate the container so they take effect.")).toBeTruthy();
    expect(screen.getByText("LLM_API_KEY")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recreate to apply keys" }));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(screen.queryByText("Keys changed. Recreate the container so they take effect.")).toBeNull();

    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "1NO" } });
    fireEvent.click(screen.getByRole("button", { name: "Add key" }));
    expect(screen.getByRole("alert").textContent).toContain("Use a key name like MAPS_KEY.");
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "MAPS_KEY" } });
    fireEvent.click(screen.getByRole("button", { name: "Add key" }));
    expect(screen.getByRole("alert").textContent).toContain("Add a value for that key.");
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Add key" }));
    expect(await screen.findByText("MAPS_KEY")).toBeTruthy();
    expect(screen.queryByDisplayValue("secret")).toBeNull();

    // Typing a name that is already on the list turns the button into a replace.
    expect(screen.getByRole("form", { name: "Add or replace a key" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "LLM_API_KEY" } });
    expect(screen.getByRole("button", { name: "Replace key" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "NEW_ONE" } });
    expect(screen.getByRole("button", { name: "Add key" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove LLM_API_KEY" }));
    await vi.waitFor(() => expect(seen.some((view) => view.envKeys.length === 0)).toBe(true));
  });

  it("shows the banner without controls when the session cannot change keys", () => {
    render(<SecretsFold slug="kit" config={config({ recreate: true, envKeys: [] })} canMutate={false} client={vi.fn()} onConfig={vi.fn()} />);
    expect(screen.getByText("No keys yet.")).toBeTruthy();
    expect(screen.getByText("Keys changed. Recreate the container so they take effect.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Recreate to apply keys" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add key" })).toBeNull();
  });

  it("names the house keys the server supplies, without a remove button", () => {
    render(<SecretsFold slug="kit" config={config({ recreate: true, envKeys: [], house: ["LLM_MODEL", "LLM_API_KEY"] })} canMutate client={vi.fn()} onConfig={vi.fn()} />);
    expect(screen.getByRole("note").textContent).toContain("From the server: LLM_MODEL, LLM_API_KEY.");
    expect(screen.queryByRole("button", { name: "Remove LLM_MODEL" })).toBeNull();
    expect(screen.getByText("No keys yet.")).toBeTruthy();
  });

  it("reports a failed write", async () => {
    const client: ApiClient = vi.fn(() => Promise.resolve(json(500, { error: "nope" })));
    render(<SecretsFold slug="kit" config={config()} canMutate client={client} onConfig={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Keys" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove LLM_API_KEY" }));
    expect((await screen.findByRole("alert")).textContent).toContain("nope");
  });
});
