/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTagList, NewAgent } from "@/app/components/agents/NewAgent";
import { tomlFromGrants } from "@/lib/agents/mcpToml";
import type { ApiClient } from "@/app/lib/agentsHttp";
import { CAST, MAPS, card, config, json, href, buttonOf, inputOf, areaOf } from "./fixtures";

afterEach(() => {
  cleanup();
});

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
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(areaOf(await screen.findByLabelText("Persona")).value).toContain("Personal assistant");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText("Agent ID")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const moved = screen.getByRole("list", { name: "Steps" });
    expect(within(moved).getByText("1").className).toContain("bg-ok/20");
    expect(within(moved).getByText("2").className).toContain("bg-accent");
    expect((await screen.findByLabelText("Persona")).parentElement?.parentElement?.className).toContain("rounded-2xl");
  });

  it("walks the steps and posts the agent, then patches persona, keys, and tools", async () => {
    const { go, calls } = await reachTools();
    expect(screen.queryByRole("checkbox", { name: "cast" })).toBeNull();
    expect(await screen.findByRole("checkbox", { name: "maps" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "maps" }));
    fireEvent.click(screen.getByRole("button", { name: "Create agent" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Add a value for maps MAPS_KEY.");
    expect(go).not.toHaveBeenCalled();

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
      persona: expect.stringContaining("Personal assistant") as string,
      mcp: tomlFromGrants([{ name: "maps", command: "maps-bin", env: ["MAPS_KEY"] }]),
    });
  });

  it("lets the keys step pass on house keys and stores only what was typed", async () => {
    const go = vi.fn();
    const { client, calls } = toolsClient([MAPS], false, ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"]);
    render(<NewAgent client={client} go={go} />);
    fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "kit" } });
    fireEvent.change(screen.getByLabelText("Shown as"), { target: { value: "Kit" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
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
      if (url === "/api/tools") {
        return json(500, { error: "request_failed" });
      }
      if ((init?.method ?? "GET") === "POST") {
        return json(400, { error: "bad_slug" });
      }
      return json(500, { error: "nope" });
    });
    const { rerender } = render(<NewAgent client={broken} go={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Agent ID"), { target: { value: "kit" } });
    fireEvent.change(screen.getByLabelText("Shown as"), { target: { value: "Kit" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("LLM_BASE_URL"), { target: { value: "https://llm.example/v1" } });
    fireEvent.change(screen.getByLabelText("LLM_API_KEY"), { target: { value: "secret" } });
    fireEvent.change(screen.getByLabelText("LLM_MODEL"), { target: { value: "m" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not reach agents. Try again.");
    expect((buttonOf(screen.getByRole("button", { name: "Create agent" }))).disabled).toBe(true);

    let released = false;
    const pending: ApiClient = vi.fn(async () => {
      await Promise.resolve();
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
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
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
