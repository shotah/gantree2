import { beforeEach, describe, expect, it, vi } from "vitest";
import { principalHeaders, type Principal } from "@/lib/door/gate";
import type { Role } from "@/lib/door/users";

const state = vi.hoisted(() => {
  /** KV rows the fake DIRECTORY serves; the value `"throw"` makes that read fail. */
  const rows: Record<string, string | undefined> = {};
  return { mode: "ok", rows };
});

const headerState = vi.hoisted(() => ({ current: new Headers() }));

vi.mock("cloudflare:workers", () => ({
  get env() {
    if (state.mode === "throw") {
      throw new Error("no binding");
    }
    if (state.mode === "missing") {
      return undefined;
    }
    return {
      DIRECTORY: {
        get: async (key: string) => {
          if (state.rows[key] === "throw") {
            throw new Error("kv down");
          }
          return state.rows[key] ?? null;
        },
        put: async () => undefined,
        delete: async () => undefined,
      },
    };
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => headerState.current,
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string): never => {
    throw new Error(`REDIRECT ${path}`);
  },
}));

import Home from "@/app/page";

const SUB = "118200000000000000001";

function signIn(role: Role, agents: string[]) {
  const who: Principal = {
    sub: SUB,
    email: "ada@example.com",
    role,
    agents,
    entry: { sub: SUB, email: "ada@example.com" },
  };
  headerState.current = new Headers(principalHeaders(who));
}

async function destination(): Promise<string> {
  try {
    await Home();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const match = /^REDIRECT (.+)$/.exec(message);
    if (match?.[1]) {
      return match[1];
    }
    throw error;
  }
  throw new Error("expected redirect");
}

describe("home router", () => {
  beforeEach(() => {
    state.mode = "ok";
    state.rows = {};
    headerState.current = new Headers();
  });

  it("sends a missing principal to login", async () => {
    expect(await destination()).toBe("/login");
    headerState.current = new Headers({ "x-gantree-sub": SUB, "x-gantree-role": "nope" });
    expect(await destination()).toBe("/login");
  });

  it("sends admin and operator to /agents", async () => {
    state.rows[`sub:${SUB}`] = JSON.stringify(["kit"]);
    signIn("admin", []);
    expect(await destination()).toBe("/agents");
    signIn("operator", ["kit"]);
    expect(await destination()).toBe("/agents");
  });

  it("sends a member with one admitted agent into that chat", async () => {
    state.rows[`sub:${SUB}`] = JSON.stringify(["kit"]);
    signIn("member", []);
    expect(await destination()).toBe("/chat/kit");
  });

  it("sends a member with several agents to the picker", async () => {
    state.rows[`sub:${SUB}`] = JSON.stringify(["kit"]);
    signIn("member", ["ada"]);
    expect(await destination()).toBe("/chat");
  });

  it("keeps a header grant when the directory admits nobody", async () => {
    signIn("member", ["kit"]);
    expect(await destination()).toBe("/chat/kit");
  });

  it("uses header grants when the worker env is missing or the directory throws", async () => {
    signIn("member", ["solo"]);
    state.mode = "missing";
    expect(await destination()).toBe("/chat/solo");
    state.mode = "throw";
    expect(await destination()).toBe("/chat/solo");
    state.mode = "ok";
    state.rows[`sub:${SUB}`] = "throw";
    signIn("member", ["solo"]);
    expect(await destination()).toBe("/chat/solo");
  });

  it("sends a member with no agents to the picker", async () => {
    signIn("member", []);
    expect(await destination()).toBe("/chat");
  });
});
