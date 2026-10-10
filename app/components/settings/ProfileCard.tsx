"use client";

import { useEffect, useState } from "react";
import { cardClass, chipClass, PageHeader } from "@/app/components/shared/PageHeader";
import { TreeMark } from "@/app/components/shared/TreeMark";
import { api } from "@/app/lib/api";
import { displaySlug } from "@/lib/chat/slug";
import { readSession, type SessionView } from "@/lib/door/landing";

export type ApiClient = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function roleChip(role: SessionView["role"]): string {
  if (role === "admin") {
    return "border-ok/40 text-ok";
  }
  if (role === "operator") {
    return "border-info/40 text-info";
  }
  return "border-accent-line text-mark";
}

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

  const letter = session?.email?.trim().charAt(0).toUpperCase() ?? "";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <PageHeader
        title="Profile"
        blurb="This browser's signed-in account."
        theme={false}
        nav={[
          { href: "/settings", label: "Settings" },
          { href: "/agents", label: "Agents" },
        ]}
      />

      {phase === "loading"
        ? <p className="text-sm text-muted">Loading profile.</p>
        : null}

      {error
        ? <p role="alert" className="rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
        : null}

      {session
        ? (
            <section aria-label="Account" className={cardClass}>
              <div className="flex items-start gap-4">
                <span
                  aria-hidden
                  className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-mark text-xl font-semibold text-canvas shadow-sm ring-2 ring-panel"
                >
                  {letter
                    ? letter
                    : <TreeMark className="h-8 w-8" />}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-xl font-semibold tracking-tight text-fg">{session.email ?? "—"}</h2>
                  <p className="mt-2">
                    <span className={`${chipClass} ${roleChip(session.role)}`}>{session.role}</span>
                  </p>
                  <div className="mt-4">
                    <p className="text-xs font-medium text-muted">Agents</p>
                    {session.agents.length > 0
                      ? (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {session.agents.map((agent) => (
                              <a
                                key={agent}
                                href={`/chat/${encodeURIComponent(agent)}`}
                                className={`${chipClass} border-accent-line bg-accent-soft/40 text-mark hover:bg-accent-soft`}
                              >
                                {displaySlug(agent)}
                              </a>
                            ))}
                          </div>
                        )
                      : <p className="mt-1 text-sm text-body">None</p>}
                  </div>
                  <div className="mt-4">
                    <p className="text-xs font-medium text-muted">Sub</p>
                    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
                      <code className="break-all rounded-lg bg-canvas/70 px-2 py-1 font-mono text-xs text-fg ring-1 ring-line">{session.sub}</code>
                      <button
                        type="button"
                        aria-label="Copy sub"
                        onClick={() => void copySub()}
                        className="rounded-xl border border-line px-2 py-1 text-xs text-body hover:bg-track"
                      >
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )
        : null}

      <form action="/api/auth/logout" method="post">
        <button type="submit" className="rounded-xl border border-line px-4 py-2 text-sm text-muted hover:bg-track hover:text-body">
          Log out
        </button>
      </form>
    </main>
  );
}
