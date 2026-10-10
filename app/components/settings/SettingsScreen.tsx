"use client";

import { useEffect, useState } from "react";
import { FontSelect } from "@/app/components/shared/FontSelect";
import { ThemeSelect } from "@/app/components/shared/ThemeSelect";
import { api } from "@/app/lib/api";
import { readSession, type SessionView } from "@/lib/door/landing";
import { SpendCard } from "./SpendCard";

export type ApiClient = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function WhoCard() {
  return (
    <section aria-label="Who can be here" className="rounded border border-line bg-panel px-4 py-4">
      <h2 className="text-sm font-medium text-fg">Who can be here</h2>
      <p className="mt-2 text-sm text-body">
        Admins and members named in the environment stay locked. They are checked on every sign-in.
      </p>
      <p className="mt-2 text-sm text-body">
        Everyone else is a row on Users: an admin, an operator for the agents on that row, or a member who can chat where an agent allows them.
      </p>
      <a href="/users" className="mt-3 inline-flex rounded border border-line px-3 py-1.5 text-sm text-body hover:bg-track">
        Open users
      </a>
    </section>
  );
}

export function SettingsScreen({ client = api }: { client?: ApiClient }) {
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
          setError("Could not load your account.");
          setSession(null);
          return;
        }
        setSession(who);
        setError(null);
      })
      .catch(() => {
        if (dead) {
          return;
        }
        setError("Could not load your account.");
      });
    return () => {
      dead = true;
    };
  }, [client]);

  const staff = session?.role === "admin" || session?.role === "operator";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="space-y-1">
        <a href="/" className="text-sm text-muted hover:text-body">gantree</a>
        <h1 className="text-2xl font-semibold text-fg">Settings</h1>
        <p className="text-sm text-muted">Theme and type size for this browser.</p>
      </header>

      {error
        ? <p role="alert" className="rounded border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
        : null}

      <section aria-label="Appearance" className="flex flex-col gap-3 rounded border border-line bg-panel px-4 py-4">
        <h2 className="text-sm font-medium text-fg">Appearance</h2>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">Theme</span>
          <div className="w-40">
            <ThemeSelect />
          </div>
        </div>
        <FontSelect />
      </section>

      {session?.role === "admin" ? <WhoCard /> : null}
      {staff
        ? <SpendCard agents={session?.role === "admin" ? null : session?.agents ?? []} client={client} />
        : null}
    </main>
  );
}
