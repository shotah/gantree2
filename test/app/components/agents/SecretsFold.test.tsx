/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecretsFold, cleanSecretKey } from "@/app/components/agents/SecretsFold";
import type { ApiClient } from "@/app/lib/agentsHttp";
import type { AgentConfigView } from "@/lib/agents/types";
import { config, json, textBody } from "./fixtures";

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
  it("adds and removes keys without showing values", async () => {
    const seen: AgentConfigView[] = [];
    function Harness({ client }: { client: ApiClient }) {
      const [view, setView] = useState(config());
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
    const client: ApiClient = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const method = init?.method ?? "GET";
      if (method === "GET") {
        return json(200, config({ envKeys: ["LLM_API_KEY"] }));
      }
      const body = JSON.parse(textBody(init?.body)) as { env: Record<string, string | null> };
      const key = Object.keys(body.env)[0] ?? "";
      const envKeys = body.env[key] === null ? [] : ["LLM_API_KEY", key];
      return json(200, config({ envKeys, recreate: true }));
    });
    render(<Harness client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Keys" }));
    expect(screen.getByText("LLM_API_KEY")).toBeTruthy();

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

  it("hides the form when the session cannot change keys", () => {
    render(<SecretsFold slug="kit" config={config({ envKeys: [] })} canMutate={false} client={vi.fn()} onConfig={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Keys" }));
    expect(screen.getByText("No keys yet.")).toBeTruthy();
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
