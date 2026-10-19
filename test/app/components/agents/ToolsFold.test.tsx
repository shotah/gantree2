/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectChatHint,
  draftId,
  envPatchFor,
  GARMIN_AUTH_HINT,
  GOOGLE_ANOTHER_MAILBOX,
  grantFor,
  KEY_PLACEHOLDER_MISSING,
  KEY_PLACEHOLDER_SET,
  missingNeeds,
  oauthLine,
  stravaCallbackHost,
  stravaDomainHint,
  ToolsFold,
  withGrant,
} from "@/app/components/agents/ToolsFold";
import { toolCatalog } from "@/lib/agents/catalog";
import { keyHint, knownKey } from "@/lib/agents/keys";
import { PLATFORM_GOOGLE_LINE } from "@/lib/agents/platform";
import { tomlFromGrants } from "@/lib/agents/mcpToml";
import type { ApiClient } from "@/app/lib/agentsHttp";
import type { AgentConfigView, AgentStatus, ToolEntry } from "@/lib/agents/types";
import { CAST, MAPS, STATUS, config, json, href, inputOf, textBody } from "./fixtures";

afterEach(() => {
  cleanup();
});

const GOOGLE: ToolEntry = { id: "google", binary: "google-bin", needs: ["G_ID", "G_SECRET"], optional: [], oauth: true, homeOnly: false };

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

const GARMIN: ToolEntry = { id: "garmin", binary: "garmin-bin", needs: [], optional: [], oauth: false, homeOnly: false };
const STRAVA: ToolEntry = { id: "strava", binary: "strava-bin", needs: [], optional: [], oauth: true, homeOnly: false };

function Harness({ client, tools, start, canMutate = true, seen, status = null, onPickKey }: {
  client: ApiClient;
  tools: ToolEntry[];
  start: AgentConfigView;
  canMutate?: boolean;
  seen?: AgentConfigView[];
  status?: AgentStatus | null;
  onPickKey?: (name: string) => void;
}) {
  const [view, setView] = useState(start);
  return (
    <ToolsFold
      slug="kit"
      config={view}
      tools={tools}
      canMutate={canMutate}
      status={status}
      client={client}
      onPickKey={onPickKey}
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
    expect(screen.getByRole("button", { name: "Connect cast" })).toBeTruthy();
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

  it("uses the platform client until Use my own client is checked", async () => {
    const client: ApiClient = vi.fn(async () => json(200, config({
      mcp: tomlFromGrants([grantFor(GOOGLE)], ""),
      envKeys: ["GOOGLE_OWN_CLIENT"],
    })));
    render(<Harness client={client} tools={[GOOGLE]} start={config({ mcp: tomlFromGrants([grantFor(GOOGLE)], ""), envKeys: [] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.getByText(PLATFORM_GOOGLE_LINE)).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Keys for google" })).toBeNull();
    expect(screen.queryByText("google needs G_SECRET")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Use my own client" }));
    await vi.waitFor(() => expect(screen.getByText("google needs G_SECRET")).toBeTruthy());
    expect(screen.getByRole("form", { name: "Keys for google" })).toBeTruthy();
  });

  it("shows a tool's keys under it when on: missing gets a field, set gets a replace field", async () => {
    const seen: AgentConfigView[] = [];
    const patches: Record<string, string>[] = [];
    const client: ApiClient = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const body = JSON.parse(textBody(init?.body)) as { env: Record<string, string> };
      patches.push(body.env);
      const envKeys = ["LLM_API_KEY", "G_ID", "GOOGLE_OWN_CLIENT", ...Object.keys(body.env)];
      return json(200, config({ mcp: tomlFromGrants([grantFor(GOOGLE)], ""), envKeys, recreate: true }));
    });
    const start = config({ mcp: tomlFromGrants([grantFor(GOOGLE)], ""), envKeys: ["LLM_API_KEY", "G_ID", "GOOGLE_OWN_CLIENT"] });
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
        start={config()}
        status={status}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.getByText("not connected")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect garmin" })).toBeNull();
    expect(screen.getByText(GARMIN_AUTH_HINT)).toBeTruthy();
    expect(screen.getByText(connectChatHint("google"))).toBeTruthy();
    expect(screen.queryByText("Sign in from chat before this publishes.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect google" }));
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith(
      "https://accounts.example/auth?redirect_uri=http://127.0.0.1:3000/api/auth/catch",
      "_blank",
      "noopener,noreferrer",
    ));
    open.mockRestore();
  });

  it("keeps Connect google after it is connected so another mailbox can be added", async () => {
    const status: AgentStatus = { ...STATUS, published: ["google"] };
    expect(oauthLine(status, "google")).toBe("connected");
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const client: ApiClient = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      expect(href(input)).toBe("/api/agents/kit/auth/start");
      expect(JSON.parse(textBody(init?.body))).toEqual({ plugin: "google" });
      return json(200, { url: "https://accounts.example/auth" });
    });
    render(<Harness client={client} tools={[GOOGLE]} start={config()} status={status} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.getByText("connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect google" })).toBeTruthy();
    expect(screen.getByText(GOOGLE_ANOTHER_MAILBOX)).toBeTruthy();
    expect(screen.getByText(connectChatHint("google"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect google" }));
    await vi.waitFor(() => expect(open).toHaveBeenCalledWith(
      "https://accounts.example/auth",
      "_blank",
      "noopener,noreferrer",
    ));
    open.mockRestore();
  });

  it("tells Strava the callback domain is the hostname, then the host on the authorize URL", async () => {
    const sent = "https://www.strava.com/oauth/authorize?redirect_uri=" + encodeURIComponent("https://gantree.bldhosting.com/api/auth/catch");
    expect(stravaCallbackHost(sent)).toBe("gantree.bldhosting.com");
    expect(stravaCallbackHost("https://www.strava.com/oauth/authorize")).toBe("");
    expect(stravaCallbackHost("not a url")).toBe("");
    expect(stravaDomainHint("localhost")).toBe("Authorization Callback Domain is the hostname only (localhost).");
    expect(stravaDomainHint("localhost", "localhost")).toBe(stravaDomainHint("localhost"));
    expect(stravaDomainHint("localhost", "gantree.bldhosting.com")).toBe(
      "Authorization Callback Domain is the hostname only. Strava received gantree.bldhosting.com.",
    );
    expect(stravaDomainHint("")).toBe("Authorization Callback Domain is the hostname only.");

    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const client: ApiClient = vi.fn(async () => {
      await Promise.resolve();
      return json(200, { url: sent });
    });
    render(<Harness client={client} tools={[STRAVA]} start={config()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.getByText(connectChatHint("strava"))).toBeTruthy();
    expect(screen.getByText(stravaDomainHint(window.location.hostname))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect strava" }));
    await vi.waitFor(() => expect(screen.getByText(stravaDomainHint(window.location.hostname, "gantree.bldhosting.com"))).toBeTruthy());
    expect(open).toHaveBeenCalledWith(sent, "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("explains where to get every tool key", () => {
    const tools = toolCatalog().filter((tool) => tool.needs.length > 0 || tool.optional.length > 0);
    const start = config({
      mcp: tomlFromGrants(tools.map(grantFor), ""),
      envKeys: ["GOOGLE_OWN_CLIENT", "GOOGLE_HEALTH_OWN_CLIENT"],
    });
    render(<Harness client={vi.fn()} tools={tools} start={start} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    const names = tools.flatMap((tool) => [...tool.needs, ...tool.optional]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const meta = knownKey(name);
      const line = meta ? keyHint(meta) : "";
      expect(screen.getByText((_, node) => node?.tagName === "P" && node.textContent === line), name).toBeTruthy();
      expect(meta?.where.startsWith("https://"), name).toBe(true);
    }
    expect(screen.queryByRole("button", { name: /About / })).toBeNull();
  });

  it("explains where to get the flights and rentals keys", () => {
    const flights: ToolEntry = {
      id: "flights",
      binary: "flights-search-mcp",
      needs: ["SERPAPI_API_KEY"],
      optional: [],
      oauth: false,
      homeOnly: false,
    };
    const rentals: ToolEntry = {
      id: "rentals",
      binary: "rentals-search-mcp",
      needs: ["RENTCAST_API_KEY"],
      optional: [],
      oauth: false,
      homeOnly: false,
    };
    const start = config({
      mcp: tomlFromGrants([grantFor(flights), grantFor(rentals)], ""),
      envKeys: ["SERPAPI_API_KEY", "RENTCAST_API_KEY"],
    });
    render(<Harness client={vi.fn()} tools={[flights, rentals]} start={start} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    const flightsLink = screen.getByRole("link", { name: "https://serpapi.com/manage-api-key" });
    const rentalsLink = screen.getByRole("link", { name: "https://app.rentcast.io/app/api" });
    expect(flightsLink.getAttribute("href")).toBe("https://serpapi.com/manage-api-key");
    expect(rentalsLink.getAttribute("href")).toBe("https://app.rentcast.io/app/api");
    expect(screen.getByText(/copy the private API key/)).toBeTruthy();
    expect(screen.getByText(/Create API key/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /About / })).toBeNull();
  });

  it("links a missing catalog key so Keys can preselect it", () => {
    const picked: string[] = [];
    const start = config({ mcp: tomlFromGrants([grantFor(MAPS)], ""), envKeys: [] });
    render(<Harness client={vi.fn()} tools={[MAPS]} start={start} onPickKey={(name) => picked.push(name)} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.click(screen.getByRole("button", { name: "maps needs MAPS_KEY" }));
    expect(picked).toEqual(["MAPS_KEY"]);
  });
});
