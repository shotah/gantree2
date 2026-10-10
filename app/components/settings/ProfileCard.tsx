"use client";

import { useEffect, useState } from "react";
import { api } from "@/app/lib/api";
import { readSession, type SessionView } from "@/lib/door/landing";

export type ApiClient = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function ProfileCard({ client = api }: { client?: ApiClient }) {
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
          setError("Could not load your profile.");
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
        setError("Could not load your profile.");
        setPhase("ready");
      });
    return () => {
      dead = true;
    };
  }, [client]);

  async function copySub() {
    if (!session) {
      return;
    }
    try {
      await navigator.clipboard.writeText(session.sub);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="space-y-1">
        <a href="/" className="text-sm text-muted hover:text-body">gantree</a>
        <h1 className="text-2xl font-semibold text-fg">Profile</h1>
      </header>

      {phase === "loading"
        ? <p className="text-sm text-muted">Loading profile.</p>
        : null}

      {error
        ? <p role="alert" className="rounded border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
        : null}

      {session
        ? (
            <section aria-label="Account" className="rounded border border-line bg-panel px-4 py-4">
              <dl className="grid grid-cols-[5.5rem_1fr] items-baseline gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted">Email</dt>
                <dd className="text-body">{session.email ?? "—"}</dd>
                <dt className="text-muted">Role</dt>
                <dd className="text-body">{session.role}</dd>
                <dt className="text-muted">Agents</dt>
                <dd className="text-body">{session.agents.length > 0 ? session.agents.join(", ") : "None"}</dd>
                <dt className="text-muted">Sub</dt>
                <dd className="flex min-w-0 flex-wrap items-center gap-2">
                  <code className="break-all font-mono text-xs text-fg">{session.sub}</code>
                  <button
                    type="button"
                    aria-label="Copy sub"
                    onClick={() => void copySub()}
                    className="rounded border border-line px-2 py-1 text-xs text-body hover:bg-track"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </dd>
              </dl>
            </section>
          )
        : null}

      <form action="/api/auth/logout" method="post">
        <button type="submit" className="rounded border border-line px-3 py-1.5 text-sm text-body hover:bg-track">
          Log out
        </button>
      </form>
    </main>
  );
}
