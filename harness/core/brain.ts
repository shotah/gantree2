/**
 * The facade the Agent Durable Object drives. `harness/agent` implements it;
 * `edge/agent.do.ts` (via `harness/room`) calls it. Nothing else crosses this
 * line, so the loop can be tested with fakes and the DO stays thin.
 */
import type { Clock } from "./clock";
import type { Logger } from "./log";
import type { ChatProvider } from "./provider";
import type { Sql } from "./sql";
import type { Plugin, TokenStore } from "./tools";
import type { Emit, Inbound } from "./wire";

export type BrainDeps = {
  sql: Sql;
  clock: Clock;
  log: Logger;
  provider: ChatProvider;
  plugins: Plugin[];
  tokens: TokenStore;
  fetch: typeof fetch;
  /** The agent's env map from the DO config (LLM + plugin keys, flags). */
  env: Readonly<Record<string, string>>;
  /** Persona markdown parts from the DO config, in order. */
  persona: { name: string; text: string }[];
  /** Room slug, for logs and the `status` frame. */
  slug: string;
  /** Inventory display name when the room knows it; otherwise derive from slug. */
  name?: string;
  /** Re-arm the DO alarm after the harness clock changes (boot and after inbound turns). */
  onClock?: (at: number | null) => void | Promise<void>;
};

export type Brain = {
  /**
   * One phone frame in. Everything out goes through `emit` (drafts while
   * streaming, then `reply`, plus any `cmds`/`aims`/`todo`/`react`/`typing`).
   * Resolves when the turn is finished; the DO keeps the invocation alive.
   */
  handleInbound(frame: Inbound, emit: Emit): Promise<void>;
  /**
   * Alarm fired. Runs due cron/watch/planner/consolidation work, emitting
   * through `emit` as it goes. Returns the next wake (ms) or null.
   */
  alarm(emit: Emit): Promise<number | null>;
  /** Earliest future due time across cron, watch, planner, consolidator; null when idle. */
  nextAlarm(): number | null;
  /** Publish `status` (plugins published/skipped) and the `cmds` catalog; called on open and on config change. */
  announce(emit: Emit): Promise<void>;
  /** `/auth <plugin>` support: start a provider login; null when the plugin has none. */
  authStart(plugin: string, redirectUri: string, state: string): Promise<{ url: string } | null>;
  authFinish(plugin: string, redirectUri: string, code: string): Promise<void>;
  /** Optional user-idle gate; absent in test fakes that omit cron/user tracking. */
  idle?: (now: number, anchorMs: number, idleMs?: number) => { stop: boolean; wakeAt: number };
};
