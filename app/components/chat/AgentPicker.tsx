"use client";

import { useEffect, useState } from "react";
import { cardClass, PageHeader } from "@/app/components/shared/PageHeader";
import { api } from "@/app/lib/api";
import { displaySlug } from "@/lib/chat/slug";
import { readSession, type SessionView } from "@/lib/door/landing";

export type ApiClient = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const EMPTY = "No agent yet — ask your admin to add you to one.";

export function AgentPicker({ client = api }: { client?: ApiClient }) {
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    void client("/api/auth/me")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("request_failed");
        }
        return readSession(await res.json());
      })
      .then((who) => {
        if (dead) {
          return;
        }
        if (!who) {
          setError("Could not load agents.");
          setSession(null);
        } else {
          setSession(who);
          setError(null);
        }
        setPhase("ready");
      })
      .catch(() => {
        if (dead) {
          return;
        }
        setError("Could not load agents.");
        setPhase("ready");
      });
    return () => {
      dead = true;
    };
  }, [client]);

  const staff = session?.role === "admin" || session?.role === "operator";
  const agents = [...(session?.agents ?? [])].sort((a, b) => a.localeCompare(b));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <PageHeader
        title="Choose an agent"
        blurb="Every door here opens a chat."
        nav={staff ? [{ href: "/agents", label: "Manage agents" }] : []}
      />

      {phase === "loading"
        ? <p className="text-sm text-muted">Loading agents.</p>
        : null}

      {phase === "ready" && agents.length > 0
        ? (
            <ul className="grid gap-3 sm:grid-cols-2" aria-label="Agents">
              {agents.map((slug) => {
                const name = displaySlug(slug);
                return (
                  <li key={slug}>
                    <a
                      href={`/chat/${encodeURIComponent(slug)}`}
                      aria-label={name}
                      className={`${cardClass} group flex items-center gap-4 transition hover:border-accent-line hover:bg-track/60`}
                    >
                      <span
                        aria-hidden
                        className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-accent to-mark text-2xl font-bold text-canvas shadow-sm"
                      >
                        {name.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xl font-semibold text-fg">{name}</span>
                        <span className="block text-xs text-muted">{slug}</span>
                      </span>
                      <span aria-hidden className="text-lg text-accent transition group-hover:translate-x-0.5">→</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )
        : null}

      {phase === "ready" && agents.length === 0
        ? (
            <div className={`${cardClass} flex flex-col items-start gap-4`}>
              <p className="text-sm text-body" role={error ? "alert" : undefined}>{error ?? EMPTY}</p>
              <form action="/api/auth/logout" method="post">
                <button type="submit" className="rounded-xl border border-line bg-canvas/60 px-3 py-1.5 text-sm text-body hover:border-accent-line hover:text-fg">
                  Log out
                </button>
              </form>
            </div>
          )
        : null}
    </main>
  );
}
