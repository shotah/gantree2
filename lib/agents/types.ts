/**
 * The agents contract. Frozen shapes shared by the Settings DO (inventory,
 * samples), the Agent DO (config, status frames, room users), and the
 * screens under `app/agents`.
 *
 * HTTP — same origin, session cookie, role gate (`lib/door/users.ts`):
 *
 *   GET    /api/agents                      → { agents: AgentCard[] }     admin all · operator theirs · member 403
 *   POST   /api/agents  AgentCreate         → { agent: AgentCard } 201    admin
 *   GET    /api/agents/:slug                → { agent: AgentCard }        canRun
 *   DELETE /api/agents/:slug                → 204                         admin
 *   GET    /api/agents/:slug/config         → AgentConfigView             canRun
 *   PATCH  /api/agents/:slug/config  AgentConfigPatch → AgentConfigView   canRun
 *   GET    /api/agents/:slug/status         → AgentStatus                 canRun
 *   GET    /api/agents/:slug/log?after=N    → LogPage                     canRun
 *   GET    /api/agents/:slug/users          → { users: RoomUser[] }       canRun (Agent DO `allow`)
 *   PUT    /api/agents/:slug/users  { users: RoomUser[] } → same          canRun
 *   POST   /api/agents/:slug/auth/start { plugin } → { url }            canRun (google, strava, google-health)
 *   GET    /api/agents/:slug/bearer         → { bearer }                  admin, loopback dev only
 *   GET    /api/tools                       → { tools: ToolEntry[], house: string[] }  any signed-in
 *   GET    /api/samples?agent=&since=       → { samples: SampleRow[] }    canRun (admin: all when no agent)
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
};

export type AgentCreate = {
  slug: string;
  name?: string;
  tags?: string[];
};

/** Cached on the Agent DO from the brain's `status`, `perf`, and `log` frames. */
export type AgentStatus = {
  harness: "connected" | "disconnected";
  /** ms epoch of the last brain connect. */
  since: number | null;
  /** From the last `status` frame. */
  published: string[];
  skipped: { name: string; reason: string }[];
  /** ms epoch of the last `perf` frame. */
  lastTurn: number | null;
  /** Last error-level `log` line since the brain connected. */
  lastError: { message: string; at: string } | null;
  /** Rolling since the brain connected. */
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
};

/** `PATCH` body. `null` deletes that env key. Omitted fields are untouched. */
export type AgentConfigPatch = {
  env?: Record<string, string | null>;
  mcp?: string;
  persona?: string;
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
