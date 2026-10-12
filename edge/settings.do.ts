/**
 * Settings Durable Object. One SQLite actor for users, audit, samples, and
 * the agent inventory. RPC is the only way in; SQL lives in
 * `lib/door/settingsStore` and `lib/agents/registry`.
 */
import { DurableObject } from "cloudflare:workers";
import {
  openRegistry,
  type AgentCreateBody,
  type AgentDelete,
  type AgentEnabledSet,
  type AgentRegistry,
  type AgentWrite,
} from "@/lib/agents/registry";
import type { AgentRow } from "@/lib/agents/types";
import {
  asSql,
  openSettings,
  type AuditEvent,
  type PutOutcome,
  type PutUserInput,
  type RemoveOutcome,
  type SampleInput,
  type SampleOutcome,
  type SampleQuery,
  type SampleRow,
  type SettingsStore,
} from "@/lib/door/settingsStore";
import type { UserRow } from "@/lib/door/users";

export class Settings extends DurableObject {
  #store: SettingsStore;
  #agents: AgentRegistry;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    const sql = asSql(ctx.storage.sql);
    this.#store = openSettings(sql);
    this.#agents = openRegistry(sql);
  }

  listUsers(): Promise<UserRow[]> {
    return this.#store.list();
  }

  putUser(input: PutUserInput, actor: string): Promise<PutOutcome> {
    return this.#store.putUser(input, actor);
  }

  removeUser(entry: string, actor: string): Promise<RemoveOutcome> {
    return this.#store.removeUser(entry, actor);
  }

  audit(limit?: number): Promise<AuditEvent[]> {
    return this.#store.audit(limit);
  }

  addSample(input: SampleInput): Promise<SampleOutcome> {
    return this.#store.addSample(input);
  }

  listSamples(query?: SampleQuery): Promise<SampleRow[]> {
    return this.#store.listSamples(query);
  }

  listAgents(): Promise<AgentRow[]> {
    return this.#agents.list();
  }

  getAgent(slug: string): Promise<AgentRow | null> {
    return this.#agents.get(slug);
  }

  createAgent(input: AgentCreateBody, actor: string): Promise<AgentWrite> {
    return this.#agents.create(input, actor);
  }

  deleteAgent(slug: string, actor: string): Promise<AgentDelete> {
    return this.#agents.remove(slug, actor);
  }

  setAgentEnabled(slug: string, enabled: boolean, actor: string): Promise<AgentEnabledSet> {
    return this.#agents.setEnabled(slug, enabled, actor);
  }

  deleteSamplesForAgent(agent: string): Promise<void> {
    return this.#store.deleteSamplesForAgent(agent);
  }

  removeSlugFromOperators(slug: string): Promise<void> {
    return this.#store.removeSlugFromOperators(slug);
  }
}
