/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTagList, NewAgent } from "@/app/components/agents/NewAgent";
import { tomlFromGrants } from "@/lib/agents/mcpToml";
import type { ApiClient } from "@/app/lib/agentsHttp";
import type { ToolEntry } from "@/lib/agents/types";
import { CAST, MAPS, card, config, json, href, buttonOf, inputOf, areaOf } from "./fixtures";

const GOOGLE: ToolEntry = {
  id: "google",
  binary: "google-bin",
  needs: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
  oauth: true,
  homeOnly: false,
};

afterEach(() => {
  cleanup();
});

async function nextFromName() {
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByLabelText("Persona");
}

async function nextFromPersona() {
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByLabelText("LLM_BASE_URL");
}

function toolsClient(tools = [MAPS, CAST], failPatch = false, house: string[] = []): { client: ApiClient; calls: { url: string; method: string; body?: string }[] } {
  const calls: { url: string; method: string; body?: string }[] = [];
  let patches = 0;
  const client: ApiClient = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    await Promise.resolve();
    const url = href(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ url, method, body });
    if (url === "/api/tools") {
      return json(200, { tools, house });
    }
    if (url === "/api/auth/me" && method === "GET") {
      return json(200, { sub: "u1", email: "creator@example.com", role: "admin", agents: [] });
    }
    if (url === "/api/agents" && method === "GET") {
      return json(200, { agents: [] });
    }
    if (method === "POST") {
      return json(201, { agent: card() });
    }
    if (method === "PATCH") {
      patches += 1;
      if (failPatch && patches === 1) {
        return json(500, { error: "bad_json" });
      }
      return json(200, config());
    }
    return json(500, { error: url });
  });
  return { client, calls };
}

async function reachTools(home = false, tools = [MAPS, CAST]) {
  const go = vi.fn();
  const { client, calls } = toolsClient(tools);
  render(<NewAgent home={home} client={client} go={go} />);
  fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "Kit" } });
  expect(screen.getByText("Use a letter, then lowercase letters, digits, or hyphens.")).toBeTruthy();
  expect((buttonOf(screen.getByRole("button", { name: "Next" }))).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "kit" } });
  fireEvent.change(screen.getByLabelText("Shown as"), { target: { value: "Kit" } });
  fireEvent.change(screen.getByLabelText("Tags"), { target: { value: "home, home, travel" } });
  await nextFromName();
  const personaValue = areaOf(screen.getByLabelText("Persona")).value;
  expect(personaValue).toContain("Personal assistant");
  expect(personaValue).toContain("Your name is Kit.");
  expect(personaValue).toContain("- **Name:** Kit");
  expect(personaValue).not.toContain("(pick one)");
  expect(personaValue).toContain("creator@example.com");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText("Agent ID")).toBeTruthy();
  await nextFromName();
  await nextFromPersona();
  fireEvent.change(screen.getByLabelText("LLM_BASE_URL"), { target: { value: "https://llm.example/v1" } });
  fireEvent.change(screen.getByLabelText("LLM_API_KEY"), { target: { value: "secret" } });
  fireEvent.change(screen.getByLabelText("LLM_MODEL"), { target: { value: "m" } });
  fireEvent.click(screen.getByRole("button", { name: "Add a key" }));
  fireEvent.change(screen.getByLabelText("Key"), { target: { value: "EXTRA" } });
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "v" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  return { go, client, calls };
}

describe("parseTagList", () => {
  it("splits, trims, and drops blanks and duplicates", () => {
    expect(parseTagList(" home, home, , travel ")).toEqual(["home", "travel"]);
    expect(parseTagList("")).toEqual([]);
  });
});

describe("NewAgent", () => {
  it("blocks step 2 when the id or display name collides", async () => {
    const client: ApiClient = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const url = href(input);
      const method = init?.method ?? "GET";
      if (url === "/api/tools") {
        return json(200, { tools: [], house: [] });
      }
      if (url === "/api/auth/me") {
        return json(200, { sub: "u1", email: null, role: "admin", agents: [] });
      }
      if (url === "/api/agents" && method === "GET") {
        return json(200, { agents: [card()] });
      }
      return json(500, { error: "nope" });
    });
    render(<NewAgent client={client} go={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "kit" } });
    fireEvent.change(screen.getByLabelText("Shown as"), { target: { value: "Other" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect((await screen.findByRole("alert")).textContent).toContain("That agent ID is already in use.");
    expect(screen.getByText("Step 1 of 4 — Name")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "bob" } });
    fireEvent.change(screen.getByLabelText("Shown as"), { target: { value: "Kit" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect((await screen.findByRole("alert")).textContent).toContain("That agent name is already in use.");
    expect(screen.getByText("Step 1 of 4 — Name")).toBeTruthy();
  });

  it("paints a step rail and puts each step on a card", async () => {
    render(<NewAgent client={toolsClient().client} go={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "New agent" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Agents" }).getAttribute("href")).toBe("/agents");
    expect(screen.getByText("Step 1 of 4 — Name")).toBeTruthy();
    const rail = screen.getByRole("list", { name: "Steps" });
    expect(within(rail).getByText("1").className).toContain("bg-accent");
    expect(within(rail).getByText("1").getAttribute("aria-current")).toBe("step");
    expect(within(rail).getByText("4").className).toContain("bg-track");
    expect(screen.getByLabelText("Agent ID").parentElement?.parentElement?.className).toContain("bg-panel/90");
    fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "kit" } });
    fireEvent.change(screen.getByLabelText("Shown as"), { target: { value: "Kit" } });
    await nextFromName();
    const moved = screen.getByRole("list", { name: "Steps" });
    expect(within(moved).getByText("1").className).toContain("bg-ok/20");
    expect(within(moved).getByText("2").className).toContain("bg-accent");
    expect(screen.getByLabelText("Persona").parentElement?.parentElement?.className).toContain("rounded-2xl");
  });

  it("walks the steps and posts the agent, then patches persona, keys, and tools", async () => {
    const { go, calls } = await reachTools();
    expect(screen.queryByRole("checkbox", { name: "cast" })).toBeNull();
    expect(await screen.findByRole("checkbox", { name: "maps" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "maps" }));
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Add a value for maps MAPS_KEY.");
    expect(go).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("MAPS_KEY"), { target: { value: "m" } });
    expect(screen.getByLabelText("MAPS_KEY")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("MAPS_KEY"), { target: { value: "mk" } });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith("/agents/kit"));
    const post = calls.find((call) => call.method === "POST");
    const patch = calls.find((call) => call.method === "PATCH");
    expect(JSON.parse(post?.body ?? "{}")).toEqual({ slug: "kit", name: "Kit", tags: ["home", "travel"] });
    expect(JSON.parse(patch?.body ?? "{}")).toEqual({
      env: {
        LLM_BASE_URL: "https://llm.example/v1",
        LLM_API_KEY: "secret",
        LLM_MODEL: "m",
        EXTRA: "v",
        MAPS_KEY: "mk",
      },
      persona: expect.stringMatching(/Your name is Kit\.\n[\s\S]*- \*\*Name:\*\* Kit/) as string,
      mcp: tomlFromGrants([{ name: "maps", command: "maps-bin", env: ["MAPS_KEY"] }]),
    });
  });

  it("keeps the tools password field while typing and patches the partial value", async () => {
    const { go, calls } = await reachTools();
    fireEvent.click(await screen.findByRole("checkbox", { name: "maps" }));
    fireEvent.change(screen.getByLabelText("MAPS_KEY"), { target: { value: "m" } });
    expect(screen.getByLabelText("MAPS_KEY")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith("/agents/kit"));
    expect(JSON.parse(calls.find((call) => call.method === "PATCH")?.body ?? "{}")).toMatchObject({
      env: { MAPS_KEY: "m" },
    });
  });

  it("shows default keys UI without paste until Import a .env is opened", async () => {
    render(<NewAgent client={toolsClient().client} go={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "kit" } });
    fireEvent.change(screen.getByLabelText("Shown as"), { target: { value: "Kit" } });
    await nextFromName();
    await nextFromPersona();
    expect(screen.getByLabelText("LLM_BASE_URL")).toBeTruthy();
    expect(screen.getByLabelText("LLM_API_KEY")).toBeTruthy();
    expect(screen.getByLabelText("LLM_MODEL")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a key" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import a .env" })).toBeTruthy();
    expect(screen.queryByLabelText("Paste env")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Import a .env" }));
    expect(screen.getByLabelText("Paste env")).toBeTruthy();
    expect(buttonOf(screen.getByRole("button", { name: "Import a .env" })).getAttribute("aria-expanded")).toBe("true");
  });

  it("imports pasted env into LLM fields and extras on create", async () => {
    const go = vi.fn();
    const { client, calls } = toolsClient([], false, ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"]);
    render(<NewAgent client={client} go={go} />);
    fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "kit" } });
    fireEvent.change(screen.getByLabelText("Shown as"), { target: { value: "Kit" } });
    await nextFromName();
    await nextFromPersona();
    fireEvent.click(screen.getByRole("button", { name: "Import a .env" }));
    fireEvent.change(screen.getByLabelText("Paste env"), {
      target: { value: "LLM_MODEL=gpt-4\nGARMIN_EMAIL=you@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import keys" }));
    expect((await screen.findByRole("status")).textContent).toContain("Imported 2 keys.");
    expect(inputOf(screen.getByLabelText("LLM_MODEL")).value).toBe("gpt-4");
    expect(inputOf(screen.getByLabelText("Key")).value).toBe("GARMIN_EMAIL");
    expect(inputOf(screen.getByLabelText("Value")).value).toBe("you@example.com");
    expect(areaOf(screen.getByLabelText("Paste env")).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create agent" }));
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith("/agents/kit"));
    const patch = calls.find((call) => call.method === "PATCH");
    expect(JSON.parse(patch?.body ?? "{}")).toMatchObject({
      env: {
        LLM_MODEL: "gpt-4",
        GARMIN_EMAIL: "you@example.com",
      },
    });
  });

  it("counts pasted tool keys on the tools step without retyping", async () => {
    const go = vi.fn();
    const { client, calls } = toolsClient([MAPS, GOOGLE], false, ["LLM_BASE_URL", "LLM_API_KEY"]);
    render(<NewAgent client={client} go={go} />);
    fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "kit" } });
    fireEvent.change(screen.getByLabelText("Shown as"), { target: { value: "Kit" } });
    await nextFromName();
    await nextFromPersona();
    fireEvent.click(screen.getByRole("button", { name: "Import a .env" }));
    fireEvent.change(screen.getByLabelText("Paste env"), {
      target: {
        value: [
          "# oauth block",
          "LLM_MODEL=gpt-4",
          "GOOGLE_OAUTH_CLIENT_ID=gid",
          "GOOGLE_OAUTH_CLIENT_SECRET=gsec",
          "MAPS_KEY=mk",
        ].join("\n"),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import keys" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "maps" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "google" }));
    const mapsBlock = screen.getByRole("checkbox", { name: "maps" }).closest("div");
    const googleBlock = screen.getByRole("checkbox", { name: "google" }).closest("div");
    expect(mapsBlock).toBeTruthy();
    expect(googleBlock).toBeTruthy();
    expect(within(mapsBlock as HTMLElement).getByText("set")).toBeTruthy();
    expect(within(googleBlock as HTMLElement).getAllByText("set")).toHaveLength(2);
    expect(within(mapsBlock as HTMLElement).queryByLabelText("MAPS_KEY")).toBeNull();
    expect(within(googleBlock as HTMLElement).queryByLabelText("GOOGLE_OAUTH_CLIENT_ID")).toBeNull();
    expect(within(googleBlock as HTMLElement).queryByLabelText("GOOGLE_OAUTH_CLIENT_SECRET")).toBeNull();
    expect(screen.queryByDisplayValue("gsec")).toBeNull();
    expect(screen.queryByDisplayValue("mk")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith("/agents/kit"));
    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch?.body ?? "").not.toContain("# oauth");
    expect(JSON.parse(patch?.body ?? "{}")).toMatchObject({
      env: {
        LLM_MODEL: "gpt-4",
        GOOGLE_OAUTH_CLIENT_ID: "gid",
        GOOGLE_OAUTH_CLIENT_SECRET: "gsec",
        MAPS_KEY: "mk",
      },
      mcp: tomlFromGrants([
        { name: "maps", command: "maps-bin", env: ["MAPS_KEY"] },
        { name: "google", command: "google-bin", env: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"] },
      ]),
    });
  });

  it("still prompts for tool keys not covered by paste", async () => {
    const go = vi.fn();
    const { client, calls } = toolsClient([MAPS, GOOGLE], false, ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"]);
    render(<NewAgent client={client} go={go} />);
    fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "kit" } });
    fireEvent.change(screen.getByLabelText("Shown as"), { target: { value: "Kit" } });
    await nextFromName();
    await nextFromPersona();
    fireEvent.click(screen.getByRole("button", { name: "Import a .env" }));
    fireEvent.change(screen.getByLabelText("Paste env"), {
      target: { value: "GOOGLE_OAUTH_CLIENT_ID=gid\nGOOGLE_OAUTH_CLIENT_SECRET=gsec" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import keys" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "maps" }));
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Add a value for maps MAPS_KEY.");
    fireEvent.click(screen.getByRole("checkbox", { name: "google" }));
    const googleBlock = screen.getByRole("checkbox", { name: "google" }).closest("div");
    expect(googleBlock).toBeTruthy();
    expect(within(googleBlock as HTMLElement).getAllByText("set")).toHaveLength(2);
    expect(within(googleBlock as HTMLElement).queryByLabelText("GOOGLE_OAUTH_CLIENT_ID")).toBeNull();
    fireEvent.change(screen.getByLabelText("MAPS_KEY"), { target: { value: "mk" } });
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith("/agents/kit"));
    const patch = calls.find((call) => call.method === "PATCH");
    expect(JSON.parse(patch?.body ?? "{}")).toMatchObject({
      env: {
        GOOGLE_OAUTH_CLIENT_ID: "gid",
        GOOGLE_OAUTH_CLIENT_SECRET: "gsec",
        MAPS_KEY: "mk",
      },
    });
  });

  it("lets the keys step pass on house keys and stores only what was typed", async () => {
    const go = vi.fn();
    const { client, calls } = toolsClient([MAPS], false, ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"]);
    render(<NewAgent client={client} go={go} />);
    fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "kit" } });
    fireEvent.change(screen.getByLabelText("Shown as"), { target: { value: "Kit" } });
    await nextFromName();
    await nextFromPersona();
    expect((await screen.findByRole("note")).textContent).toContain("House keys on the server: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL.");
    expect(inputOf(screen.getByLabelText("LLM_API_KEY")).placeholder).toBe("house");
    expect(buttonOf(screen.getByRole("button", { name: "Next" })).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("LLM_MODEL"), { target: { value: "mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create agent" }));
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith("/agents/kit"));
    const patch = calls.find((call) => call.method === "PATCH");
    expect(JSON.parse(patch?.body ?? "{}")).toMatchObject({ env: { LLM_MODEL: "mine" } });
    expect(JSON.parse(patch?.body ?? "{}")).not.toHaveProperty("env.LLM_API_KEY");
  });

  it("still needs every LLM key typed when the house covers only some", async () => {
    render(<NewAgent client={toolsClient([MAPS], false, ["LLM_BASE_URL"]).client} go={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "kit" } });
    fireEvent.change(screen.getByLabelText("Shown as"), { target: { value: "Kit" } });
    await nextFromName();
    await nextFromPersona();
    await screen.findByRole("note");
    expect(buttonOf(screen.getByRole("button", { name: "Next" })).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("LLM_API_KEY"), { target: { value: "k" } });
    fireEvent.change(screen.getByLabelText("LLM_MODEL"), { target: { value: "m" } });
    expect(buttonOf(screen.getByRole("button", { name: "Next" })).disabled).toBe(false);
  });

  it("shows home tools and the sign-in note when home=1", async () => {
    await reachTools(true);
    expect(await screen.findByRole("checkbox", { name: "cast" })).toBeTruthy();
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText("Sign in from chat before this publishes.")).toBeTruthy();
  });

  it("says when the catalog has nothing to show", async () => {
    await reachTools(false, [CAST]);
    expect(await screen.findByText("No tools to show.")).toBeTruthy();
  });

  it("retries the config patch without creating the agent twice", async () => {
    const go = vi.fn();
    const { client, calls } = toolsClient([MAPS], true);
    render(<NewAgent client={client} go={go} />);
    fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "kit" } });
    fireEvent.change(screen.getByLabelText("Shown as"), { target: { value: "Kit" } });
    await nextFromName();
    await nextFromPersona();
    fireEvent.change(screen.getByLabelText("LLM_BASE_URL"), { target: { value: "https://llm.example/v1" } });
    fireEvent.change(screen.getByLabelText("LLM_API_KEY"), { target: { value: "secret" } });
    fireEvent.change(screen.getByLabelText("LLM_MODEL"), { target: { value: "m" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("button", { name: "Create agent" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    expect((await screen.findByRole("alert")).textContent).toContain("That request was not valid JSON.");
    expect(go).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((inputOf(screen.getByLabelText("Agent ID"))).disabled).toBe(true);
    await nextFromName();
    await nextFromPersona();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith("/agents/kit"));
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(2);
  });

  it("shows a tools failure and a create failure", async () => {
    const broken: ApiClient = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const url = href(input);
      const method = init?.method ?? "GET";
      if (url === "/api/tools") {
        return json(500, { error: "request_failed" });
      }
      if (url === "/api/auth/me") {
        return json(200, { sub: "u1", email: null, role: "admin", agents: [] });
      }
      if (url === "/api/agents" && method === "GET") {
        return json(200, { agents: [] });
      }
      if (method === "POST") {
        return json(400, { error: "bad_slug" });
      }
      return json(500, { error: "nope" });
    });
    const { rerender } = render(<NewAgent client={broken} go={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "kit" } });
    fireEvent.change(screen.getByLabelText("Shown as"), { target: { value: "Kit" } });
    await nextFromName();
    await nextFromPersona();
    fireEvent.change(screen.getByLabelText("LLM_BASE_URL"), { target: { value: "https://llm.example/v1" } });
    fireEvent.change(screen.getByLabelText("LLM_API_KEY"), { target: { value: "secret" } });
    fireEvent.change(screen.getByLabelText("LLM_MODEL"), { target: { value: "m" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not reach agents. Try again.");
    expect((buttonOf(screen.getByRole("button", { name: "Create agent" }))).disabled).toBe(true);

    let released = false;
    const pending: ApiClient = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      await Promise.resolve();
      const url = href(input);
      const method = init?.method ?? "GET";
      if (url === "/api/auth/me") {
        return json(200, { sub: "u1", email: null, role: "admin", agents: [] });
      }
      if (url === "/api/agents" && method === "GET") {
        return json(200, { agents: [] });
      }
      if (!released) {
        return json(200, { tools: [] });
      }
      return json(400, { error: "bad_slug" });
    });
    rerender(<NewAgent client={pending} go={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "kit" } });
    fireEvent.change(screen.getByLabelText("Shown as"), { target: { value: "Kit" } });
    await nextFromName();
    await nextFromPersona();
    fireEvent.change(screen.getByLabelText("LLM_BASE_URL"), { target: { value: "https://llm.example/v1" } });
    fireEvent.change(screen.getByLabelText("LLM_API_KEY"), { target: { value: "secret" } });
    fireEvent.change(screen.getByLabelText("LLM_MODEL"), { target: { value: "m" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    released = true;
    fireEvent.click(await screen.findByRole("button", { name: "Create agent" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Use a letter, then lowercase letters, digits, or hyphens.");
  });

  it("assigns the new agent url when no router is passed", async () => {
    const assign = vi.fn();
    const previous = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { assign, replace: vi.fn() } });
    const { client } = toolsClient([MAPS]);
    render(<NewAgent client={client} />);
    fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "kit" } });
    fireEvent.change(screen.getByLabelText("Shown as"), { target: { value: "Kit" } });
    await nextFromName();
    await nextFromPersona();
    fireEvent.change(screen.getByLabelText("LLM_BASE_URL"), { target: { value: "https://llm.example/v1" } });
    fireEvent.change(screen.getByLabelText("LLM_API_KEY"), { target: { value: "secret" } });
    fireEvent.change(screen.getByLabelText("LLM_MODEL"), { target: { value: "m" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create agent" }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/agents/kit"));
    Object.defineProperty(window, "location", { configurable: true, value: previous });
  });

  it("drops a tool response that arrives after unmount", async () => {
    let release: (value: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const client: ApiClient = vi.fn(() => pending);
    const { unmount } = render(<NewAgent client={client} />);
    unmount();
    release(json(200, { tools: [MAPS] }));
    await pending;
    expect(screen.queryByText("New agent")).toBeNull();
  });
});
