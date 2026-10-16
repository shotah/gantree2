/**
 * The agents contract. Frozen shapes shared by the Settings DO (inventory,
 * samples), the Agent DO (config, status frames, room users), and the
 * screens under `app/agents`.
 *
 * HTTP — same origin, session cookie, role gate (`lib/door/users.ts`):
 *
 *   GET    /api/agents                      → { agents: AgentCard[] }     admin
 *   POST   /api/agents  AgentCreate         → { agent: AgentCard } 201    admin
 *   POST   /api/agents/:slug/clone { slug, name?, memories? } → { agent: AgentCard } 201  admin + control source
 *   GET    /api/agents/:slug                → { agent: AgentCard }        admin
 *   DELETE /api/agents/:slug                → 204                         admin (destroy)
 *   GET    /api/agents/:slug/enabled        → { enabled }                 admin/operator/member
 *   POST   /api/agents/:slug/enabled { enabled } → { agent: AgentCard }   admin
 *   GET    /api/agents/:slug/config         → AgentConfigView             admin
 *   PATCH  /api/agents/:slug/config  AgentConfigPatch → AgentConfigView   admin
 *   GET    /api/agents/:slug/status         → AgentStatus                 admin
 *   POST   /api/agents/:slug/restart        → AgentStatus                 admin
 *   GET    /api/agents/:slug/log?after=N    → LogPage                     admin
 *   GET    /api/agents/:slug/users          → { users: RoomUser[] }       admin (Agent DO `allow`)
 *   PUT    /api/agents/:slug/users  { users: RoomUser[] } → same          admin
 *   POST   /api/agents/:slug/auth/start { plugin } → { url }            admin (google, strava, google-health)
 *   GET    /api/agents/:slug/bearer         → { bearer }                  admin, loopback dev only
 *   GET    /api/tools                       → { tools: ToolEntry[], house: string[] }  any signed-in
 *   GET    /api/samples?agent=&since=       → { samples: SampleRow[] }    admin
 *
 * Errors are `{ error: string }` with the status. `401` = door (see app/lib/api.ts), `403` = role.
 */
import type { RoomUser } from "@/lib/chat/allow";
import type { SampleRow } from "@/lib/door/settingsStore";
import type { HouseEnv } from "./house";

export type { RoomUser, SampleRow };

/** One slug grammar everywhere: letter first, then letters, digits, hyphen, max 32 (`lib/chat/slug.ts`, `/ws/<slug>`). */
export const AGENT_SLUG = /^[a-z][a-z0-9-]{0,31}$/;

/** Settings DO `agents` row — the inventory. Never secrets. */
export type AgentRow = {
  slug: string;
  /** Display name, e.g. "Kit". */
  name: string;
  /** `sub` of the admin who created it. */
  createdBy: string;
  createdAt: number;
  /** Board labels — whose keys, which house. Never secrets. */
  tags: string[];
  /** Inventory on/off. Off pauses chat and schedules; data stays on the Agent DO. */
  enabled: boolean;
};

export type AgentCreate = {
  slug: string;
  name?: string;
  tags?: string[];
};

/** What the in-process harness is doing. The Agent DO computes this; a socket does not. */
export type BrainState = "ready" | "needs_keys" | "error" | "starting";

/** One plugin from the registry boot. `reason` is set when `state` is `skipped`. */
export type PluginStatus = {
  name: string;
  state: "ready" | "skipped";
  /** `no_key`, `no_oauth`, `disabled`, `error`, and the other registry skip codes. */
  reason?: string;
};

/**
 * Harness status the Agent DO computes from the registry boot, plus the
 * `perf` / `log` counters. `published`, `skipped`, and `lastTurn` mirror
 * `plugins` and `lastTurnAt` so older readers keep working.
 */
export type AgentStatus = {
  state: BrainState;
  /** ms epoch of the last harness open. */
  since: number | null;
  /** `PACKAGE_VERSION` of the isolate that answered. */
  version: string;
  /** ms epoch of the last `perf` frame. */
  lastTurnAt: number | null;
  /** Same instant as `lastTurnAt`. */
  lastTurn: number | null;
  plugins: PluginStatus[];
  /** Ready plugin names, registry order. The Tools fold reads this. */
  published: string[];
  /** Skipped plugins. The Tools fold reads this. */
  skipped: { name: string; reason: string }[];
  /** Last error-level `log` line. Cleared when the harness opens. */
  lastError: { message: string; at: string } | null;
  /** Rolling totals. They survive a restart; a fresh isolate keeps the stored row. */
  perf: { turns: number; prompt: number; completion: number; errors: number };
};

/** What the `config` frame carries. Stored on the Agent DO. */
export type AgentConfig = {
  /** Secrets and keys. Values are write-only over HTTP. */
  env: Record<string, string>;
  /** `mcp.toml` text. Server names are the plugin grants. */
  mcp: string;
  /** `PERSONA.md` text. */
  persona: string;
  /** Whole hours before idle stop; null uses the default (48). */
  idleHours: number | null;
  updatedAt: number | null;
};

/** `GET /api/agents/:slug/config` — env values redacted to their key names. */
export type AgentConfigView = {
  envKeys: string[];
  /** Key names the Worker env supplies to every agent (`lib/agents/house.ts`). An agent's own key wins. */
  house: string[];
  mcp: string;
  persona: string;
  updatedAt: number | null;
  /** True when env changed since the last applied start marker. */
  recreate: boolean;
  /** Resolved idle stop window in whole hours (48 when stored null). */
  idleHours: number;
};

/** `PATCH` body. `null` deletes that env key. Omitted fields are untouched. */
export type AgentConfigPatch = {
  env?: Record<string, string | null>;
  mcp?: string;
  persona?: string;
  idleHours?: number | null;
};

export type AgentCard = AgentRow & {
  status: AgentStatus | null;
  /** This session may mutate (config, users). */
  canMutate: boolean;
};

export type LogLine = {
  /** Monotonic per DO; `after` cursor. */
  seq: number;
  at: string;
  level: string;
  message: string;
  dropped?: number;
};

export type LogPage = { lines: LogLine[]; next: number };

/** One in-process plugin, the row the tools grid toggles. */
export type ToolEntry = {
  /** Plugin id, also the `mcp.toml` server name. */
  id: string;
  /** Same as `id`. Grants store it as the command. */
  binary: string;
  /** Env keys `ready()` treats as `no_key`. */
  needs: string[];
  /** Optional env keys for this plugin, in catalog order. */
  optional: string[];
  /** Redirect login via `/api/auth/catch` (google, google-health, strava). Garmin is not this flag. */
  oauth: boolean;
  /** LAN-only; hidden on Cloudflare, shown under celld. */
  homeOnly: boolean;
};

/** One `[[server]]` block in `mcp.toml`, as the Tools fold edits it. */
export type Grant = {
  name: string;
  command: string;
  /** Extra args after the command; optional. */
  args?: string[];
  /** Env keys this grant forwards; optional. */
  env?: string[];
};

/** Bindings the agents layer reads. Additive to `AgentEnv` / `DoorEnv`. */
export type AgentsEnv = HouseEnv & {
  SETTINGS?: DurableObjectNamespace;
  AGENT?: DurableObjectNamespace;
};
