/**
 * In-process tools. What used to be twelve MCP servers over stdio is now
 * twelve `Plugin` modules under `harness/plugins/`. The shapes stay MCP-shaped
 * (`tools/list` entries and `content[]` results) so the agent loop, the Tools
 * grid, and the host-manifest files are unchanged.
 */
import type { Clock } from "./clock";
import type { Logger } from "./log";
import type { Sql } from "./sql";

/** JSON Schema object for a tool's arguments — the same text the manifest shows. */
export type JsonSchema = Record<string, unknown>;

export type ToolContent
  = | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource"; uri: string; mimeType?: string; text?: string };

/**
 * MCP `tools/call` result. `isError` is a tool-level failure the model sees as text.
 * `retryAfter` (ms epoch) is set when a call was refused until a budget resets;
 * schedulers such as watch park until then instead of retrying on their interval.
 */
export type ToolResult = { content: ToolContent[]; isError?: boolean; retryAfter?: number };

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /**
   * Tools are plural (`.cursor/rules/harness-plugins-plural.mdc`): they take a
   * range/list/prefix and return a list. A tool that is inherently one item
   * (`account_get`) says why here; `test/harness/plugins/plural.test.ts` fails
   * any tool that is neither.
   */
  single?: string;
};

export type Tool = ToolDef & {
  call(args: Record<string, unknown>, ctx: CallContext): Promise<ToolResult>;
};

/** Per-call facts the harness used to pass as env or `_meta`. */
export type CallContext = {
  /** Room human this turn is for (`sub`); empty on cron/system turns. */
  userId: string;
  /** Session the turn belongs to. */
  sessionId: string;
  /** Last known location for this human, when the phone sent one. */
  geo?: { lat: number; lon: number; accuracy?: number; at?: number };
  signal?: AbortSignal;
};

/** What a plugin gets when it is constructed for one agent. */
export type PluginContext = {
  /** The agent's env map (LLM key, provider keys, flags). Read, never log. */
  env: Readonly<Record<string, string>>;
  /** Shared SQLite. Prefix tables with the plugin name: `strava_token`. */
  sql: Sql;
  clock: Clock;
  log: Logger;
  fetch: typeof fetch;
  /** OAuth tokens, by provider id (`google`, `strava`, `garmin`). */
  tokens: TokenStore;
};

/** Encrypted at rest by the store; a plugin sees plaintext. */
export type OAuthToken = {
  accessToken: string;
  refreshToken?: string;
  /** ms epoch. */
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
  /** Provider-specific extras (Garmin consumer secrets, athlete id, …). */
  extra?: Record<string, string>;
};

export type TokenStore = {
  get(provider: string): Promise<OAuthToken | null>;
  put(provider: string, token: OAuthToken): Promise<void>;
  delete(provider: string): Promise<void>;
};

/** Why a plugin is not published, mirroring the harness `status.skipped[].reason`. */
export type SkipReason = "no_key" | "no_oauth" | "disabled" | "error";

export type Plugin = {
  /** Manifest name — `google`, `strava`, … matches `harness/mcp/<name>` and the host-manifest. */
  name: string;
  /**
   * Null when the plugin can serve; otherwise why not (missing key, no
   * OAuth yet). The agent loop publishes `status.skipped` from this.
   */
  ready(ctx: PluginContext): Promise<SkipReason | null>;
  /** The tool list. Stable across calls for one ctx. */
  tools(ctx: PluginContext): Tool[];
  /**
   * `/auth <name>` in chat: start an OAuth flow, return the URL to show the
   * human. Only for plugins with a provider login. `instruction` is set when
   * the human must read a prompt (Garmin MFA paste) rather than only open `url`.
   */
  authStart?(ctx: PluginContext, redirectUri: string, state: string): Promise<{ url: string; instruction?: string }>;
  /** The OAuth catch: exchange `code`, store the token. */
  authFinish?(ctx: PluginContext, redirectUri: string, code: string): Promise<void>;
};

export const textResult = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
export const errorResult = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });
export const jsonResult = (value: unknown): ToolResult => textResult(JSON.stringify(value));
