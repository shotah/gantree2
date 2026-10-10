/**
 * The agents contract. Frozen shapes shared by the Settings DO (inventory,
 * samples), the Agent DO (config, harness frames, room users), the Harness DO
 * (container), and the screens under `app/agents`. Change here only with the
 * owning side in the same PR.
 *
 * HTTP — same origin, session cookie, role gate (`lib/door/users.ts`):
 *
 *   GET    /api/agents                      → { agents: AgentCard[] }     admin all · operator theirs · member 403
 *   POST   /api/agents  AgentCreate         → { agent: AgentCard } 201    admin
 *   GET    /api/agents/:slug                → { agent: AgentCard }        canRun
 *   DELETE /api/agents/:slug                → 204                         admin (stops container; R2 snapshot kept)
 *   GET    /api/agents/:slug/config         → AgentConfigView             canRun
 *   PATCH  /api/agents/:slug/config  AgentConfigPatch → AgentConfigView   canRun (env change → `recreate` hint)
 *   GET    /api/agents/:slug/status         → AgentStatus                 canRun
 *   GET    /api/agents/:slug/log?after=N    → LogPage                     canRun
 *   GET    /api/agents/:slug/users          → { users: RoomUser[] }       canRun (Agent DO `allow`)
 *   PUT    /api/agents/:slug/users  { users: RoomUser[] } → same          canRun
 *   GET    /api/agents/:slug/container      → ContainerInfo               canRun
 *   POST   /api/agents/:slug/container  ContainerAction → ContainerInfo   canRun
 *   GET    /api/tools                       → { tools: ToolEntry[] }      any signed-in
 *   GET    /api/samples?agent=&since=       → { samples: SampleRow[] }    canRun (admin: all when no agent)
 *
 * Snapshot — no cookie; the harness does a bare GET / PUT on a URL the Agent
 * DO minted into the `config` frame (`restore.*` / `put.*`):
 *
 *   GET/PUT /api/agents/:slug/snapshot/:file?exp=<ms>&sig=<hex>   file ∈ gantry_db | self_md
 *   sig = HMAC-SHA256(roomBearer, `${slug}|${file}|${method}|${exp}`), exp ≤ 15 min ahead.
 *   R2 keys: backups/<slug>/latest/<file> and backups/<slug>/<stamp>/<file>.
 *
 * Errors are `{ error: string }` with the status. `401` = door (see app/lib/api.ts), `403` = role.
 */
import type { RoomUser } from "@/lib/chat/allow";
import type { SampleRow } from "@/lib/door/settingsStore";

export type { RoomUser, SampleRow };

/** Same shape the Settings store enforces for `users.agents`. */
export const AGENT_SLUG = /^[a-z][a-z0-9-]{0,62}$/;

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

/** Cached on the Agent DO from the harness socket and its frames. */
export type AgentStatus = {
  harness: "connected" | "disconnected";
  /** ms epoch of the last harness socket open/close. */
  since: number | null;
  /** From the last `status` frame. */
  published: string[];
  skipped: { name: string; reason: string }[];
  /** ms epoch of the last `perf` frame. */
  lastTurn: number | null;
  /** From the last `snapshot` frame. */
  lastSnapshot: { stamp: string; bytes: number; at: number } | null;
  /** Rolling since the harness connected. */
  perf: { turns: number; prompt: number; completion: number; errors: number };
};

export type ContainerState = "stopped" | "starting" | "running" | "stopping" | "failed" | "unknown";

export type ContainerInfo = {
  state: ContainerState;
  /** ms epoch of the last state change, when known. */
  since: number | null;
  lastError: string | null;
  /** Image reference the binding started, when known. */
  image: string | null;
};

export type ContainerAction = { action: "start" | "stop" | "recreate" };

/** What the `config` frame carries to the harness. Stored on the Agent DO. */
export type AgentConfig = {
  /** Secrets and keys. Values are write-only over HTTP. */
  env: Record<string, string>;
  /** `mcp.toml` text. */
  mcp: string;
  /** `PERSONA.md` text. */
  persona: string;
  updatedAt: number | null;
};

/** `GET /api/agents/:slug/config` — env values redacted to their key names. */
export type AgentConfigView = {
  envKeys: string[];
  mcp: string;
  persona: string;
  updatedAt: number | null;
  /** True when env changed since the container last started. */
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
  container: ContainerInfo | null;
  /** This session may mutate (config, container, users). */
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

/** One row of the tools catalog — a plugin baked into the image (`harness/mcp.lock`). */
export type ToolEntry = {
  /** Server id = `mcp.lock` id = `[[server]] name`. */
  id: string;
  /** Binary on `/opt/mcp/<id>/`. */
  binary: string;
  /** Required env keys; empty when none. */
  needs: string[];
  /** Needs an OAuth paste flow (`/auth <id>`) before it publishes. */
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
export type AgentsEnv = {
  SETTINGS?: DurableObjectNamespace;
  AGENT?: DurableObjectNamespace;
  HARNESS?: DurableObjectNamespace;
  STORE?: R2Bucket;
};
