"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PageHeader, cardClass, chipClass } from "@/app/components/shared/PageHeader";
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
import { alertClass, boardMainClass, primaryClass, quietClass } from "./Fold";
import { relativeTime, timeStamp } from "./relativeTime";

export const BOARD_POLL_MS = 10_000;

const statClass = "rounded-xl bg-canvas/60 px-2.5 py-2";
const statLabelClass = "text-[10px] uppercase tracking-wide text-dim";
const statValueClass = "text-sm text-fg";

export function nagsFor(agent: AgentCard): string[] {
  const nags: string[] = [];
  const skipped = agent.status ? agent.status.skipped.length : 0;
  if (skipped === 1) {
    nags.push("1 tool skipped");
  } else if (skipped > 1) {
    nags.push(`${skipped} tools skipped`);
  }
  if (agent.container?.state === "failed") {
    const why = agent.status?.lastError?.message ?? agent.container.lastError;
    nags.push(why ? `Container failed: ${why}` : "Container failed");
  }
  return nags;
}

function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : "?";
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={statClass}>
      <dt className={statLabelClass}>{label}</dt>
      <dd className={statValueClass}>{children}</dd>
    </div>
  );
}

function AgentTile({ agent }: { agent: AgentCard }) {
  const published = agent.status ? agent.status.published.length : 0;
  const skipped = agent.status ? agent.status.skipped.length : 0;
  const harness = agent.status ? agent.status.harness : "unknown";
  const state = agent.container ? agent.container.state : "unknown";
  const nags = nagsFor(agent);
  const lastTurn = agent.status ? agent.status.lastTurn : null;
  const connected = harness === "connected";
  return (
    <article className={`${cardClass} flex h-full flex-col gap-4`}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-accent to-mark text-xl font-bold text-canvas shadow-sm"
        >
          {initialOf(agent.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-fg">{agent.name}</h2>
          <p className="truncate text-xs text-dim">{agent.slug}</p>
        </div>
        <p className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${connected ? "border-ok/40 bg-ok/15 text-ok" : "border-line bg-track text-dim"}`}>
          <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${connected ? "bg-ok" : "bg-faint"}`} />
          {harness}
        </p>
      </div>
      {agent.tags.length > 0
        ? (
            <ul aria-label={`Tags for ${agent.name}`} className="flex flex-wrap gap-1.5">
              {agent.tags.map((tag) => (
                <li key={tag} className={`${chipClass} border-accent-line bg-accent-soft text-mark`}>{tag}</li>
              ))}
            </ul>
          )
        : null}
      <dl className="grid grid-cols-3 gap-2">
        <Stat label="Container">{state}</Stat>
        <Stat label="Tools">{published} published · {skipped} skipped</Stat>
        <Stat label="Last turn">
          <time dateTime={timeStamp(lastTurn)}>{relativeTime(lastTurn)}</time>
        </Stat>
      </dl>
      {nags.length > 0
        ? (
            <ul aria-label={`Needs attention for ${agent.name}`} className="space-y-1">
              {nags.map((nag) => (
                <li key={nag} className="rounded-lg border border-danger-line bg-danger-soft px-2 py-1 text-xs text-danger">{nag}</li>
              ))}
            </ul>
          )
        : null}
      <div className="mt-auto flex flex-wrap gap-2">
        <a href={`/chat/${encodeURIComponent(agent.slug)}`} className={primaryClass}>
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
  const nav = [
    ...(admin ? [{ href: "/users", label: "Users" }] : []),
    { href: "/settings", label: "Settings" },
    ...(admin ? [{ href: "/agents/new", label: "New agent" }] : []),
  ];

  return (
    <main className={boardMainClass}>
      <PageHeader
        title="Agents"
        blurb="Open a chat, or manage an agent."
        nav={nav}
      />

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
            <ul aria-label="Agents" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {agents.map((agent) => (
                <li key={agent.slug} aria-label={agent.name} className="h-full">
                  <AgentTile agent={agent} />
                </li>
              ))}
            </ul>
          )
        : null}

      {agents !== null && agents.length === 0 && !denied
        ? (
            <div className={cardClass}>
              {admin
                ? (
                    <p className="text-sm text-body">
                      <a href="/agents/new" className="font-medium text-fg underline">Create your first agent</a>
                    </p>
                  )
                : <p className="text-sm text-body">No agents on your row.</p>}
            </div>
          )
        : null}
    </main>
  );
}
