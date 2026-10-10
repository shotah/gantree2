import type { AgentCard, AgentConfigView, AgentStatus, ContainerInfo, ToolEntry } from "@/lib/agents/types";
import type { Session } from "@/app/lib/agentsHttp";

export function buttonOf(element: HTMLElement): HTMLButtonElement {
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error("expected a button");
  }
  return element;
}

export function inputOf(element: HTMLElement): HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) {
    throw new Error("expected an input");
  }
  return element;
}

export function areaOf(element: HTMLElement): HTMLTextAreaElement {
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error("expected a textarea");
  }
  return element;
}

export function textBody(body: BodyInit | null | undefined): string {
  return typeof body === "string" ? body : "";
}

export function href(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const STATUS: AgentStatus = {
  harness: "connected",
  since: 1_700_000_000_000,
  published: ["maps"],
  skipped: [],
  lastTurn: 1_700_000_000_000,
  lastSnapshot: null,
  perf: { turns: 2, prompt: 10, completion: 4, errors: 0 },
};

export const CONTAINER: ContainerInfo = {
  state: "running",
  since: 1_700_000_000_000,
  lastError: null,
  image: "gantree:1",
};

export function card(over: Partial<AgentCard> = {}): AgentCard {
  return {
    slug: "kit",
    name: "Kit",
    createdBy: "sub",
    createdAt: 1,
    tags: ["home"],
    status: STATUS,
    container: CONTAINER,
    canMutate: true,
    ...over,
  };
}

export function config(over: Partial<AgentConfigView> = {}): AgentConfigView {
  return {
    envKeys: ["LLM_API_KEY"],
    mcp: "",
    persona: "Be brief.",
    updatedAt: 1,
    recreate: false,
    ...over,
  };
}

export const MAPS: ToolEntry = {
  id: "maps",
  binary: "maps-bin",
  needs: ["MAPS_KEY"],
  oauth: false,
  homeOnly: false,
};

export const CAST: ToolEntry = {
  id: "cast",
  binary: "cast-bin",
  needs: [],
  oauth: true,
  homeOnly: true,
};

export function session(role: Session["role"] = "admin", agents: string[] = ["kit"]): Session {
  return { sub: "118212345678901234567", email: "ada@example.com", role, agents };
}
