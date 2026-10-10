"use client";

import { useEffect, useState } from "react";
import { ThemeSelect } from "@/app/components/shared/ThemeSelect";
import {
  AgentsError,
  agentsMessage,
  codeOf,
  getMe,
  listAgents,
  type ApiClient,
  type Session,
} from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import type { AgentCard } from "@/lib/agents/types";
import { alertClass, boardMainClass, quietClass } from "./Fold";
import { relativeTime, timeStamp } from "./relativeTime";

export const BOARD_POLL_MS = 10_000;

export function nagsFor(agent: AgentCard): string[] {
  const nags: string[] = [];
  const skipped = agent.status ? agent.status.skipped.length : 0;
  if (skipped === 1) {
    nags.push("1 tool skipped");
  } else if (skipped > 1) {
    nags.push(`${skipped} tools skipped`);
  }
  if (agent.container?.state === "failed") {
    nags.push(agent.container.lastError ? `Container failed: ${agent.container.lastError}` : "Container failed");
  }
  return nags;
}

function AgentTile({ agent }: { agent: AgentCard }) {
  const published = agent.status ? agent.status.published.length : 0;
  const skipped = agent.status ? agent.status.skipped.length : 0;
  const harness = agent.status ? agent.status.harness : "unknown";
  const state = agent.container ? agent.container.state : "unknown";
  const nags = nagsFor(agent);
  const lastTurn = agent.status ? agent.status.lastTurn : null;
  return (
    <article className="flex h-full flex-col gap-3 rounded border border-line bg-panel px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-fg">{agent.name}</h2>
          <p className="text-xs text-dim">{agent.slug}</p>
        </div>
        <p className="flex shrink-0 items-center gap-1.5 text-xs text-body">
          <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${harness === "connected" ? "bg-ok" : "bg-faint"}`} />
          <span>{harness}</span>
        </p>
      </div>
      {agent.tags.length > 0
        ? (
            <ul aria-label={`Tags for ${agent.name}`} className="flex flex-wrap gap-1">
              {agent.tags.map((tag) => (
                <li key={tag} className="rounded border border-line px-1.5 py-0.5 text-xs text-mark">{tag}</li>
              ))}
            </ul>
          )
        : null}
      <dl className="space-y-1 text-xs text-muted">
        <div className="flex justify-between gap-2">
          <dt>Container</dt>
          <dd className="text-fg">{state}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Tools</dt>
          <dd className="text-fg">{published} published · {skipped} skipped</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Last turn</dt>
          <dd className="text-fg">
            <time dateTime={timeStamp(lastTurn)}>{relativeTime(lastTurn)}</time>
          </dd>
        </div>
      </dl>
      {nags.length > 0
        ? (
            <ul aria-label={`Needs attention for ${agent.name}`} className="space-y-1">
              {nags.map((nag) => <li key={nag} className="text-xs text-danger">{nag}</li>)}
            </ul>
          )
        : null}
      <div className="mt-auto flex flex-wrap gap-2">
        <a href={`/chat/${encodeURIComponent(agent.slug)}`} className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-canvas hover:bg-accent-hover">
          Open chat
        </a>
        <a href={`/agents/${encodeURIComponent(agent.slug)}`} className={quietClass}>Manage</a>
      </div>
    </article>
  );
}

export function AgentsBoard({ client = api, pollMs = BOARD_POLL_MS }: { client?: ApiClient; pollMs?: number }) {
  const [agents, setAgents] = useState<AgentCard[] | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let dead = false;
    const load = async () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      try {
        const [who, cards] = await Promise.all([getMe(client), listAgents(client)]);
        if (dead) {
          return;
        }
        setSession(who);
        setAgents(cards);
        setDenied(false);
        setError(null);
      } catch (err) {
        if (dead) {
          return;
        }
        if (err instanceof AgentsError && err.status === 403) {
          setDenied(true);
          setAgents([]);
          setError(null);
          return;
        }
        setDenied(false);
        setError(codeOf(err));
      }
    };
    void load();
    const id = window.setInterval(() => {
      void load();
    }, pollMs);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void load();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      dead = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [client, pollMs]);

  const admin = session?.role === "admin";

  return (
    <main className={boardMainClass}>
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <a href="/" className="text-sm text-muted hover:text-body">gantree</a>
          <h1 className="text-2xl font-semibold text-fg">Agents</h1>
          <p className="text-sm text-muted">Open a chat, or manage an agent.</p>
          <nav aria-label="Board" className="flex flex-wrap gap-3 pt-1">
            {admin ? <a href="/users" className="text-sm text-muted hover:text-body">Users</a> : null}
            <a href="/settings" className="text-sm text-muted hover:text-body">Settings</a>
            {admin ? <a href="/agents/new" className="text-sm text-muted hover:text-body">New agent</a> : null}
          </nav>
        </div>
        <div className="w-40 shrink-0">
          <ThemeSelect />
        </div>
      </header>

      {denied
        ? <p role="alert" className={alertClass}>Only an admin or an operator can open agents.</p>
        : null}
      {error
        ? <p role="alert" className={alertClass}>{agentsMessage(error)}</p>
        : null}
      {agents === null && !error && !denied
        ? <p className="text-sm text-muted">Loading agents.</p>
        : null}

      {agents !== null && agents.length > 0
        ? (
            <ul aria-label="Agents" className="grid gap-3 sm:grid-cols-2">
              {agents.map((agent) => (
                <li key={agent.slug} aria-label={agent.name}>
                  <AgentTile agent={agent} />
                </li>
              ))}
            </ul>
          )
        : null}

      {agents !== null && agents.length === 0 && !denied
        ? (
            admin
              ? (
                  <p className="text-sm text-body">
                    <a href="/agents/new" className="font-medium text-fg underline">Create your first agent</a>
                  </p>
                )
              : <p className="text-sm text-body">No agents on your row.</p>
          )
        : null}
    </main>
  );
}
