/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  draftId,
  envPatchFor,
  grantFor,
  KEY_PLACEHOLDER_MISSING,
  KEY_PLACEHOLDER_SET,
  missingNeeds,
  oauthLine,
  ToolsFold,
  withGrant,
} from "@/app/components/agents/ToolsFold";
import { tomlFromGrants } from "@/lib/agents/mcpToml";
import type { ApiClient } from "@/app/lib/agentsHttp";
import type { AgentConfigView, AgentStatus, ToolEntry } from "@/lib/agents/types";
import { CAST, MAPS, STATUS, config, json, href, inputOf, textBody } from "./fixtures";

afterEach(() => {
  cleanup();
});

const GOOGLE: ToolEntry = { id: "google", binary: "google-bin", needs: ["G_ID", "G_SECRET"], oauth: true, homeOnly: false };

describe("tool grants", () => {
  it("toggles a grant and names missing keys", () => {
    expect(withGrant([], MAPS, true)).toEqual([grantFor(MAPS)]);
    expect(withGrant([grantFor(MAPS)], { ...MAPS, binary: "next" }, true)).toEqual([grantFor({ ...MAPS, binary: "next" })]);
    expect(withGrant([grantFor(MAPS)], MAPS, false)).toEqual([]);
    expect(missingNeeds([grantFor(MAPS)], [MAPS], [])).toEqual(["maps needs MAPS_KEY"]);
    expect(missingNeeds([grantFor(MAPS)], [MAPS], ["MAPS_KEY"])).toEqual([]);
    expect(missingNeeds([{ name: "x", command: "c", env: ["Z"] }], [], [])).toEqual(["x needs Z"]);
    expect(missingNeeds([{ name: "x", command: "c" }], [], [])).toEqual([]);
  });

  it("builds an env patch from only the keys that were typed", () => {
    expect(envPatchFor(GOOGLE, {})).toEqual({});
    expect(envPatchFor(GOOGLE, { [draftId("google", "G_SECRET")]: "s3" })).toEqual({ G_SECRET: "s3" });
    expect(envPatchFor(GOOGLE, { [draftId("google", "G_ID")]: "id", [draftId("google", "G_SECRET")]: "" })).toEqual({ G_ID: "id" });
    expect(envPatchFor(GOOGLE, { [draftId("maps", "G_ID")]: "other tool's draft" })).toEqual({});
  });
});

const GARMIN: ToolEntry = { id: "garmin", binary: "garmin-bin", needs: [], oauth: false, homeOnly: false };

function Harness({ client, tools, start, canMutate = true, seen, runtime = "container", status = null }: {
  client: ApiClient;
  tools: ToolEntry[];
  start: AgentConfigView;
  canMutate?: boolean;
  seen?: AgentConfigView[];
  runtime?: "container" | "native";
  status?: AgentStatus | null;
}) {
  const [view, setView] = useState(start);
  return (
    <ToolsFold
      slug="kit"
      config={view}
      tools={tools}
      canMutate={canMutate}
      runtime={runtime}
      status={status}
      client={client}
      onConfig={(next) => {
        seen?.push(next);
        setView(next);
      }}
    />
  );
}

describe("ToolsFold", () => {
  it("patches mcp when a tool is ticked and unticked, and nags for a missing key", async () => {
    const sent: string[] = [];
    const client: ApiClient = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const body = JSON.parse(textBody(init?.body)) as { mcp: string };
      sent.push(body.mcp);
      return json(200, config({ mcp: body.mcp, envKeys: [] }));
    });
    render(<Harness client={client} tools={[MAPS, CAST]} start={config({ envKeys: [] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText("Sign in from chat before this publishes.")).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Keys for maps" })).toBeNull();
    const box = inputOf(screen.getByRole("checkbox", { name: "maps" }));
    fireEvent.click(box);
    expect(await screen.findByText("maps needs MAPS_KEY")).toBeTruthy();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toBe(tomlFromGrants([grantFor(MAPS)], ""));
    await vi.waitFor(() => expect(box.disabled).toBe(false));
    fireEvent.click(box);
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toBe(tomlFromGrants([], ""));
  });

  it("shows a tool's keys under it when on: missing gets a field, set gets a replace field", async () => {
    const seen: AgentConfigView[] = [];
    const patches: Record<string, string>[] = [];
    const client: ApiClient = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const body = JSON.parse(textBody(init?.body)) as { env: Record<string, string> };
      patches.push(body.env);
      return json(200, config({ mcp: tomlFromGrants([grantFor(GOOGLE)], ""), envKeys: ["LLM_API_KEY", "G_ID", ...Object.keys(body.env)], recreate: true }));
    });
    const start = config({ mcp: tomlFromGrants([grantFor(GOOGLE)], ""), envKeys: ["LLM_API_KEY", "G_ID"] });
    render(<Harness client={client} tools={[GOOGLE]} start={start} seen={seen} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.getByText("google needs G_SECRET")).toBeTruthy();

    const form = screen.getByRole("form", { name: "Keys for google" });
    const id = within(form).getByLabelText<HTMLInputElement>(/G_ID/);
    const secret = within(form).getByLabelText<HTMLInputElement>(/G_SECRET/);
    expect(id.type).toBe("password");
    expect(id.placeholder).toBe(KEY_PLACEHOLDER_SET);
    expect(secret.placeholder).toBe(KEY_PLACEHOLDER_MISSING);
    expect(within(form).getByText("set")).toBeTruthy();
    expect(within(form).getByText("missing")).toBeTruthy();

    const save = within(form).getByRole<HTMLButtonElement>("button", { name: "Save keys for google" });
    expect(save.disabled).toBe(true);
    fireEvent.change(secret, { target: { value: "shh" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await vi.waitFor(() => expect(patches).toEqual([{ G_SECRET: "shh" }]));
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(screen.queryByText("google needs G_SECRET")).toBeNull();
    expect(secret.value).toBe("");
    expect(secret.placeholder).toBe(KEY_PLACEHOLDER_SET);
    expect(screen.queryByDisplayValue("shh")).toBeNull();
    expect(screen.getByText("Keys changed. Recreate the container so they take effect.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recreate to apply keys" })).toBeTruthy();
  });

  it("recreates from the banner and reloads the config", async () => {
    const seen: AgentConfigView[] = [];
    const calls: string[] = [];
    const client: ApiClient = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      calls.push(`${init?.method ?? "GET"} ${href(input)}`);
      if ((init?.method ?? "GET") === "POST") {
        return json(200, { state: "running", since: 1, lastError: null, image: null });
      }
      return json(200, config({ recreate: false }));
    });
    render(<Harness client={client} tools={[MAPS]} start={config({ recreate: true })} seen={seen} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Recreate to apply keys" }));
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(calls[0]).toContain("POST ");
    expect(calls[0]).toContain("/container");
    expect(calls[1]).toContain("GET ");
    expect(screen.queryByText("Keys changed. Recreate the container so they take effect.")).toBeNull();
  });

  it("rolls the tick back when the patch fails, and looking-only sessions get read-only fields", async () => {
    const client: ApiClient = vi.fn(() => Promise.resolve(json(500, { error: "bad_json" })));
    const { unmount } = render(<Harness client={client} tools={[MAPS]} start={config({ envKeys: ["MAPS_KEY"] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    const box = inputOf(screen.getByRole("checkbox", { name: "maps" }));
    fireEvent.click(box);
    expect((await screen.findByRole("alert")).textContent).toContain("That request was not valid JSON.");
    await vi.waitFor(() => expect(box.checked).toBe(false));
    unmount();

    const on = config({ mcp: tomlFromGrants([grantFor(MAPS)], ""), envKeys: [], recreate: true });
    render(<Harness client={vi.fn()} tools={[MAPS]} start={on} canMutate={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(inputOf(screen.getByRole("checkbox", { name: "maps" })).disabled).toBe(true);
    const form = screen.getByRole("form", { name: "Keys for maps" });
    expect(within(form).getByLabelText<HTMLInputElement>(/MAPS_KEY/).disabled).toBe(true);
    expect(within(form).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Recreate to apply keys" })).toBeNull();
  });

  it("opens Connect for a native oauth plugin and skips garmin", async () => {
    const status: AgentStatus = {
      ...STATUS,
      published: ["strava"],
      skipped: [{ name: "google", reason: "no_oauth" }, { name: "maps", reason: "no_key" }],
    };
    expect(oauthLine(status, "google")).toBe("not connected");
    expect(oauthLine(status, "strava")).toBe("connected");
    expect(oauthLine(status, "maps")).toBeNull();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const client: ApiClient = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      expect(href(input)).toBe("/api/agents/kit/auth/start");
      expect(JSON.parse(textBody(init?.body))).toEqual({ plugin: "google" });
      return json(200, { url: "https://accounts.example/auth?redirect_uri=http://127.0.0.1:3000/api/auth/catch" });
    });
    render(
      <Harness
        client={client}
        tools={[GOOGLE, GARMIN]}
        start={config({ runtime: "native" })}
        runtime="native"
        status={status}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.getByText("not connected")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect garmin" })).toBeNull();
    expect(screen.queryByText("Sign in from chat before this publishes.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect google" }));
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith(
      "https://accounts.example/auth?redirect_uri=http://127.0.0.1:3000/api/auth/catch",
      "_blank",
      "noopener,noreferrer",
    ));
    open.mockRestore();
  });
});
