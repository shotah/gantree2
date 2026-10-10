import { afterEach, describe, expect, it, vi } from "vitest";
import { devDoorFor } from "@/app/login/devDoor";

type DoorState = { devUser: string | undefined; host: string | null; mode: "ok" | "throw" };

const state = vi.hoisted((): DoorState => ({ devUser: "", host: "example.com", mode: "ok" }));

vi.mock("cloudflare:workers", () => ({
  get env() {
    if (state.mode === "throw") {
      throw new Error("no binding");
    }
    return { GANTREE_DEV_USER: state.devUser };
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.host ? { host: state.host } : {}),
}));

afterEach(() => {
  state.devUser = "";
  state.host = "example.com";
  state.mode = "ok";
});

describe("devDoorFor", () => {
  it("opens on loopback with GANTREE_DEV_USER and carries next", async () => {
    state.devUser = "100000000000000000001:dev@example.com";
    state.host = "127.0.0.1:3000";
    expect(await devDoorFor("/agents")).toEqual({ label: "dev@example.com", href: "/agents" });
    expect(await devDoorFor(null)).toEqual({ label: "dev@example.com", href: "/" });
  });

  it("stays shut off loopback, without the variable, or without a host", async () => {
    state.devUser = "100000000000000000001:dev@example.com";
    state.host = "gantree.example.com";
    expect(await devDoorFor("/agents")).toBeNull();
    state.host = null;
    expect(await devDoorFor("/agents")).toBeNull();
    state.devUser = "";
    state.host = "127.0.0.1:3000";
    expect(await devDoorFor("/agents")).toBeNull();
  });

  it("swallows a missing worker env", async () => {
    state.mode = "throw";
    state.host = "127.0.0.1:3000";
    expect(await devDoorFor("/agents")).toBeNull();
  });
});
