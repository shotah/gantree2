"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PageHeader, chipClass } from "@/app/components/shared/PageHeader";
import {
  AgentsError,
  agentsMessage,
  codeOf,
  cloneAgent,
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
import type { AgentCard, AgentConfigView, ToolEntry } from "@/lib/agents/types";
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
  const [destroyStep, setDestroyStep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [keyPick, setKeyPick] = useState<{ name: string; n: number } | null>(null);
  const [cloneSlug, setCloneSlug] = useState("");
  const [cloneName, setCloneName] = useState("");

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

  async function clone(memories: boolean) {
    const nextSlug = cloneSlug.trim();
    if (!nextSlug) {
      setError("bad_slug");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await cloneAgent(slug, {
        slug: nextSlug,
        ...(cloneName.trim() ? { name: cloneName.trim() } : {}),
        ...(memories ? { memories: true } : {}),
      }, client);
      go(`/agents/${encodeURIComponent(created.slug)}`);
    } catch (err) {
      setError(codeOf(err));
    } finally {
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
        <StatusFold
          slug={agent.slug}
          status={agent.status}
          enabled={agent.enabled}
          client={client}
          onEnabled={(enabled) => setAgent((prev) => prev ? { ...prev, enabled } : prev)}
        />
        {spend}
        <PersonaFold
          slug={agent.slug}
          persona={config.persona}
          canMutate={agent.canMutate}
          client={client}
          onPersona={(persona) => setConfig((prev) => prev ? { ...prev, persona } : prev)}
        />
        <SelfFold
          slug={agent.slug}
          canMutate={agent.canMutate}
          client={client}
        />
        <SecretsFold
          slug={agent.slug}
          config={config}
          canMutate={agent.canMutate}
          client={client}
          onConfig={setConfig}
          pick={keyPick}
        />
        <ToolsFold
          slug={agent.slug}
          config={config}
          tools={tools}
          canMutate={agent.canMutate}
          status={agent.status}
          client={client}
          onConfig={setConfig}
          onPickKey={(name) => setKeyPick((prev) => ({ name, n: (prev?.n ?? 0) + 1 }))}
        />
        <UsersFold
          slug={agent.slug}
          users={users}
          canMutate={agent.canMutate}
          client={client}
          onUsers={setUsers}
        />
        <LogFold slug={agent.slug} client={client} />
        {agent.canMutate
          ? (
              <section aria-label="Clone agent" className="rounded-2xl border border-line bg-surface px-5 py-5">
                <h2 className="text-sm font-semibold text-body">Clone agent</h2>
                <p className="mt-1 text-xs text-dim">
                  Copy keys and persona into a new agent ID. Memory copy includes facts, preferences, people, insights, and episodes — not chat or room access.
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="clone-slug" className={labelClass}>New agent ID</label>
                    <input
                      id="clone-slug"
                      value={cloneSlug}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => setCloneSlug(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="clone-name" className={labelClass}>Shown name (optional)</label>
                    <input
                      id="clone-name"
                      value={cloneName}
                      autoComplete="off"
                      onChange={(e) => setCloneName(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy || !cloneSlug.trim()}
                    onClick={() => void clone(false)}
                    className={primaryClass}
                  >
                    Clone with keys
                  </button>
                  <button
                    type="button"
                    disabled={busy || !cloneSlug.trim()}
                    onClick={() => void clone(true)}
                    className={quietClass}
                  >
                    Clone with memories
                  </button>
                </div>
              </section>
            )
          : null}
        {role === "admin"
          ? (
              <section aria-label="Danger zone" className="rounded-2xl border border-danger-line bg-danger-soft/40 px-5 py-5">
                <h2 className="text-sm font-semibold text-danger">Destroy agent</h2>
                <p className="mt-1 text-xs text-dim">Type {agent.slug} to continue.</p>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor="confirm-slug" className={labelClass}>Type the agent ID to confirm</label>
                    <input
                      id="confirm-slug"
                      value={confirm}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => {
                        setConfirm(e.target.value);
                        if (destroyStep && e.target.value !== agent.slug) {
                          setDestroyStep(false);
                        }
                      }}
                      className={inputClass}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy || confirm !== agent.slug || destroyStep}
                    onClick={() => setDestroyStep(true)}
                    className={dangerClass}
                  >
                    Delete {agent.slug}
                  </button>
                </div>
                {destroyStep
                  ? (
                      <div className="mt-4 space-y-2 border-t border-danger-line/60 pt-4">
                        <p className="text-xs text-body">
                          This will delete EVERYTHING — chat, keys, memory, and the durable object — and cannot be undone. Are you sure?
                        </p>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void destroy()}
                          className={dangerClass}
                        >
                          Destroy {agent.slug}
                        </button>
                      </div>
                    )
                  : null}
              </section>
            )
          : null}
      </main>
    </FoldGroup>
  );
}
