"use client";

import { useEffect, useState } from "react";
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
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="space-y-1">
        <a href="/" className="text-sm text-muted hover:text-body">gantree</a>
        <h1 className="text-2xl font-semibold text-fg">Choose an agent</h1>
        {staff
          ? <a href="/agents" className="text-sm text-muted hover:text-body">Manage agents</a>
          : null}
      </header>

      {phase === "loading"
        ? <p className="text-sm text-muted">Loading agents.</p>
        : null}

      {phase === "ready" && agents.length > 0
        ? (
            <ul className="grid gap-3 sm:grid-cols-2" aria-label="Agents">
              {agents.map((slug) => (
                <li key={slug}>
                  <a
                    href={`/chat/${encodeURIComponent(slug)}`}
                    className="block rounded-lg border border-line bg-panel px-5 py-6 text-xl font-semibold text-fg hover:bg-track"
                  >
                    {displaySlug(slug)}
                  </a>
                </li>
              ))}
            </ul>
          )
        : null}

      {phase === "ready" && agents.length === 0
        ? (
            <div className="flex flex-col items-start gap-4">
              <p className="text-sm text-body" role={error ? "alert" : undefined}>{error ?? EMPTY}</p>
              <form action="/api/auth/logout" method="post">
                <button type="submit" className="rounded border border-line px-3 py-1.5 text-sm text-body hover:bg-track">
                  Log out
                </button>
              </form>
            </div>
          )
        : null}
    </main>
  );
}
