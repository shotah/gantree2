/**
 * Worker-side wiring: bindings in, store out. The only door file that touches
 * `cloudflare:workers`, so everything else stays testable in plain Vitest.
 *
 * Users beyond the env floor land on the Settings DO (Phase 1, next). Until
 * then the store is empty and GANTREE_ADMINS / GANTREE_ALLOW are the whole list.
 */
import { env } from "cloudflare:workers";
import type { DoorEnv } from "./http";
import { memoryStore, type UserStore } from "./users";

export function doorEnv(): DoorEnv {
  return env as unknown as DoorEnv;
}

export function userStore(): UserStore {
  return memoryStore();
}
