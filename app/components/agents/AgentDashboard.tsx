"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ThemeSelect } from "@/app/components/shared/ThemeSelect";
import {
  AgentsError,
  agentsMessage,
  codeOf,
  deleteAgent,
  getAgent,
  getConfig,
  getMe,
  getRoomUsers,
  listTools,
  type ApiClient,
} from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import type { Role } from "@/lib/door/users";
import type { RoomUser } from "@/lib/chat/allow";
import type { AgentCard, AgentConfigView, ContainerInfo, ToolEntry } from "@/lib/agents/types";
import { assignHref } from "./follow";
import { alertClass, dangerClass, inputClass, labelClass, mainClass, quietClass } from "./Fold";
import { LogFold } from "./LogFold";
import { PersonaFold } from "./PersonaFold";
import { SecretsFold } from "./SecretsFold";
import { StatusFold } from "./StatusFold";
import { ToolsFold } from "./ToolsFold";
import { UsersFold } from "./UsersFold";

export function AgentDashboard({
  slug,
  client = api,
  go = assignHref,
  spend,
}: {
  slug: string;
  client?: ApiClient;
  go?: (href: string) => void;
  spend?: ReactNode;
}) {
  const [phase, setPhase] = useState<"loading" | "ready" | "missing" | "denied" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentCard | null>(null);
  const [config, setConfig] = useState<AgentConfigView | null>(null);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [users, setUsers] = useState<RoomUser[]>([]);
  const [role, setRole] = useState<Role | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      const card = await getAgent(slug, client);
      const [cfg, toolList, room, who] = await Promise.all([
        getConfig(slug, client),
        listTools(client),
        getRoomUsers(slug, client),
        getMe(client),
      ]);
      setAgent(card);
      setConfig(cfg);
      setTools(toolList);
      setUsers(room);
      setRole(who.role);
      setPhase("ready");
    } catch (err) {
      if (err instanceof AgentsError && err.status === 404) {
        setPhase("missing");
        setError("not_found");
        return;
      }
      if (err instanceof AgentsError && err.status === 403) {
        setPhase("denied");
        setError("forbidden");
        return;
      }
      setPhase("error");
      setError(codeOf(err));
    }
  }, [slug, client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function destroy() {
    setBusy(true);
    setError(null);
    try {
      await deleteAgent(slug, client);
      go("/agents");
    } catch (err) {
      setError(codeOf(err));
      setBusy(false);
    }
  }

  if (phase !== "ready" || !agent || !config) {
    return (
      <main className={mainClass}>
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <a href="/agents" className="text-sm text-muted hover:text-body">Agents</a>
            <h1 className="text-2xl font-semibold text-fg">Agent</h1>
          </div>
          <div className="w-40 shrink-0">
            <ThemeSelect />
          </div>
        </header>
        {phase === "loading" ? <p className="text-sm text-muted">Loading agent.</p> : null}
        {phase === "missing" ? <p role="alert" className={alertClass}>{agentsMessage("not_found")}</p> : null}
        {phase === "denied" ? <p role="alert" className={alertClass}>{agentsMessage("forbidden")}</p> : null}
        {phase === "error"
          ? (
              <div className="space-y-2">
                <p role="alert" className={alertClass}>{agentsMessage(error ?? "request_failed")}</p>
                <button type="button" onClick={() => void load()} className={quietClass}>Try again</button>
              </div>
            )
          : null}
      </main>
    );
  }

  return (
    <main className={mainClass}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <a href="/agents" className="text-sm text-muted hover:text-body">Agents</a>
          <h1 className="truncate text-2xl font-semibold text-fg">{agent.name}</h1>
          <p className="text-sm text-dim">{agent.slug}</p>
          {agent.tags.length > 0
            ? (
                <ul aria-label="Tags" className="flex flex-wrap gap-1 pt-1">
                  {agent.tags.map((tag) => (
                    <li key={tag} className="rounded border border-line px-1.5 py-0.5 text-xs text-mark">{tag}</li>
                  ))}
                </ul>
              )
            : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="w-40">
            <ThemeSelect />
          </div>
          <a href={`/chat/${encodeURIComponent(agent.slug)}`} className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-canvas hover:bg-accent-hover">
            Open chat
          </a>
        </div>
      </header>

      {error ? <p role="alert" className={alertClass}>{agentsMessage(error)}</p> : null}
      {agent.canMutate
        ? null
        : (
            <p className="rounded border border-line px-3 py-2 text-sm text-muted">
              Looking only. Changes belong to an admin or this agent&apos;s operator.
            </p>
          )}
      <StatusFold
        slug={agent.slug}
        status={agent.status}
        container={agent.container}
        canMutate={agent.canMutate}
        client={client}
        onContainer={(info: ContainerInfo) => {
          setAgent((prev) => prev ? { ...prev, container: info } : prev);
        }}
      />
      {spend}
      <PersonaFold
        slug={agent.slug}
        persona={config.persona}
        canMutate={agent.canMutate}
        client={client}
        onPersona={(persona) => setConfig((prev) => prev ? { ...prev, persona } : prev)}
      />
      <SecretsFold
        slug={agent.slug}
        config={config}
        canMutate={agent.canMutate}
        client={client}
        onConfig={setConfig}
      />
      <ToolsFold
        slug={agent.slug}
        mcp={config.mcp}
        envKeys={config.envKeys}
        tools={tools}
        canMutate={agent.canMutate}
        client={client}
        onMcp={(mcp, envKeys) => setConfig((prev) => prev ? { ...prev, mcp, envKeys } : prev)}
      />
      <UsersFold
        slug={agent.slug}
        users={users}
        canMutate={agent.canMutate}
        client={client}
        onUsers={setUsers}
      />
      <LogFold slug={agent.slug} client={client} />
      {role === "admin"
        ? (
            <section aria-label="Danger zone" className="rounded border border-danger-line px-4 py-4">
              <h2 className="text-sm font-medium text-danger">Delete agent</h2>
              <p className="mt-1 text-xs text-dim">This stops the container. Type {agent.slug} to confirm.</p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="confirm-slug" className={labelClass}>Type the slug to confirm</label>
                  <input
                    id="confirm-slug"
                    value={confirm}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <button
                  type="button"
                  disabled={busy || confirm !== agent.slug}
                  onClick={() => void destroy()}
                  className={dangerClass}
                >
                  Delete {agent.slug}
                </button>
              </div>
            </section>
          )
        : null}
    </main>
  );
}
