"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PageHeader, chipClass } from "@/app/components/shared/PageHeader";
import {
  AgentsError,
  agentsMessage,
  codeOf,
  deleteAgent,
  getAgent,
  getConfig,
  getMe,
  patchConfig,
  getRoomUsers,
  listTools,
  type ApiClient,
} from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import type { Role } from "@/lib/door/users";
import type { RoomUser } from "@/lib/chat/allow";
import type { AgentCard, AgentConfigView, AgentRuntime, ContainerInfo, ToolEntry } from "@/lib/agents/types";
import { assignHref } from "./follow";
import { alertClass, dangerClass, FoldAllButton, FoldGroup, inputClass, labelClass, mainClass, primaryClass, quietClass } from "./Fold";
import { LogFold } from "./LogFold";
import { PersonaFold } from "./PersonaFold";
import { SecretsFold } from "./SecretsFold";
import { SelfFold } from "./SelfFold";
import { StatusFold } from "./StatusFold";
import { ToolsFold } from "./ToolsFold";
import { UsersFold } from "./UsersFold";

function AgentHeader({ agent, slug }: { agent: AgentCard | null; slug: string }) {
  const chatSlug = agent ? agent.slug : slug;
  return (
    <PageHeader
      crumb={{ href: "/agents", label: "Agents" }}
      title={agent ? agent.name : "Agent"}
      blurb={agent ? agent.slug : undefined}
      aside={(
        <>
          <a href={`/chat/${encodeURIComponent(chatSlug)}`} className={primaryClass}>
            Open chat
          </a>
          <FoldAllButton />
        </>
      )}
    >
      {agent && agent.tags.length > 0
        ? (
            <ul aria-label="Tags" className="flex flex-wrap gap-1.5 pt-1">
              {agent.tags.map((tag) => (
                <li key={tag} className={`${chipClass} border-accent-line bg-accent-soft text-mark`}>{tag}</li>
              ))}
            </ul>
          )
        : null}
    </PageHeader>
  );
}

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

  async function chooseRuntime(runtime: AgentRuntime) {
    if (!config || runtime === config.runtime) {
      return;
    }
    setError(null);
    try {
      setConfig(await patchConfig(slug, { runtime }, client));
    } catch (err) {
      setError(codeOf(err));
    }
  }

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
        <AgentHeader agent={null} slug={slug} />
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
    <FoldGroup id="agent">
      <main className={mainClass}>
        <AgentHeader agent={agent} slug={slug} />

        {error ? <p role="alert" className={alertClass}>{agentsMessage(error)}</p> : null}
        {agent.canMutate
          ? null
          : (
              <p className="rounded-2xl border border-info/40 bg-info/10 px-4 py-3 text-sm text-body">
                Looking only. Changes belong to an admin or this agent&apos;s operator.
              </p>
            )}
        <fieldset className="flex flex-wrap items-center gap-4">
          <legend className={labelClass}>Runtime</legend>
          {(["container", "native"] as const).map((value) => (
            <label key={value} className="flex items-center gap-1.5 text-sm text-body">
              <input
                type="radio"
                name="agent-runtime"
                value={value}
                checked={config.runtime === value}
                disabled={!agent.canMutate}
                onChange={() => {
                  void chooseRuntime(value);
                }}
              />
              {value}
            </label>
          ))}
        </fieldset>
        <StatusFold
          slug={agent.slug}
          status={agent.status}
          container={agent.container}
          canMutate={agent.canMutate}
          runtime={config.runtime}
          client={client}
          onContainer={(info: ContainerInfo) => {
            setAgent((prev) => prev ? { ...prev, container: info } : prev);
          }}
        />
        {spend}
        <PersonaFold
          slug={agent.slug}
          persona={config.persona}
          runtime={config.runtime}
          canMutate={agent.canMutate}
          client={client}
          onPersona={(persona) => setConfig((prev) => prev ? { ...prev, persona } : prev)}
        />
        <SelfFold
          slug={agent.slug}
          runtime={config.runtime}
          canMutate={agent.canMutate}
          client={client}
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
          config={config}
          tools={tools}
          canMutate={agent.canMutate}
          runtime={config.runtime}
          status={agent.status}
          client={client}
          onConfig={setConfig}
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
              <section aria-label="Danger zone" className="rounded-2xl border border-danger-line bg-danger-soft/40 px-5 py-5">
                <h2 className="text-sm font-semibold text-danger">Delete agent</h2>
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
    </FoldGroup>
  );
}
