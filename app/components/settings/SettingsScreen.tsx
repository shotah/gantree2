"use client";

import { useEffect, useState } from "react";
import { Fold, FoldAllButton, FoldGroup, mainClass } from "@/app/components/agents/Fold";
import { FontSelect } from "@/app/components/shared/FontSelect";
import { chipClass, PageHeader } from "@/app/components/shared/PageHeader";
import { api } from "@/app/lib/api";
import { landingCookie, landingPref, readSession, type LandingPref, type SessionView } from "@/lib/door/landing";
import { PlatformGoogleCard } from "./PlatformGoogleCard";
import { SpendCard } from "./SpendCard";
import { ThemeGallery } from "./ThemeGallery";

export type ApiClient = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function WhoCard() {
  return (
    <div className="flex gap-3">
      <span aria-hidden className="w-1 shrink-0 rounded-full bg-gradient-to-b from-accent to-mark" />
      <div className="min-w-0">
        <p className="text-sm text-body">
          Admins and members named in the environment stay locked. They are checked on every sign-in.
        </p>
        <p className="mt-2 text-sm text-body">
          Everyone else is a row on Users: an admin, an operator for the agents on that row, or a member who can chat where an agent allows them.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className={`${chipClass} border-ok/40 text-ok`}>admin</span>
          <span className={`${chipClass} border-info/40 text-info`}>operator</span>
          <span className={`${chipClass} border-accent-line text-mark`}>member</span>
        </div>
        <a href="/users" className="mt-3 inline-flex rounded-xl border border-line bg-canvas/60 px-3 py-1.5 text-sm text-body hover:border-accent-line hover:text-fg">
          Open users
        </a>
      </div>
    </div>
  );
}

/** Where `/` goes. The cookie is per browser, like the theme. */
function EntryCard({ landing, onLanding }: { landing: LandingPref; onLanding: (next: LandingPref) => void }) {
  const on = landing !== null;
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          checked={on}
          onChange={() => onLanding(on ? null : { slug: null })}
        />
        Open chat on entry
      </label>
      <p className="text-xs text-dim">
        {on
          ? landing.slug
            ? `Opening the app goes straight to ${landing.slug}'s chat. The chat's own settings can pick a different agent.`
            : "Visiting gantree opens your chat, or the agent picker when you have more than one. The chat's own settings can pin one agent."
          : "Visiting gantree opens the console. Turn this on to land in chat instead."}
      </p>
    </div>
  );
}

export function SettingsScreen({ client = api }: { client?: ApiClient }) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [landing, setLanding] = useState<LandingPref>(null);
  const [looksOpen, setLooksOpen] = useState(true);
  const [entryOpen, setEntryOpen] = useState(true);
  const [whoOpen, setWhoOpen] = useState(false);
  const [spendOpen, setSpendOpen] = useState(true);
  const [platformOpen, setPlatformOpen] = useState(false);

  useEffect(() => {
    setLanding(landingPref(document.cookie));
  }, []);

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

  function pickLanding(next: LandingPref) {
    document.cookie = landingCookie(next);
    setLanding(next);
  }

  const staff = session?.role === "admin" || session?.role === "operator";
  const nav = [
    { href: "/profile", label: "Profile" },
    { href: "/agents", label: "Agents" },
  ];
  if (session?.role === "admin") {
    nav.push({ href: "/users", label: "Users" });
  }

  return (
    <FoldGroup id="settings">
      <main className={mainClass}>
        <PageHeader
          title="Settings"
          blurb="Theme and type size for this browser."
          nav={nav}
          aside={<FoldAllButton />}
        />

        {error
          ? <p role="alert" className="rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
          : null}

        <Fold title="Appearance" open={looksOpen} onOpen={setLooksOpen}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-fg">Theme</h3>
              <ThemeGallery />
            </div>
            <div className="min-w-0 sm:max-w-xs">
              <FontSelect />
            </div>
          </div>
        </Fold>

        {staff
          ? (
              <Fold title="Entry" hint={landing ? "chat" : "console"} open={entryOpen} onOpen={setEntryOpen}>
                <EntryCard landing={landing} onLanding={pickLanding} />
              </Fold>
            )
          : null}

        {session?.role === "admin"
          ? (
              <>
                <Fold title="Platform" hint="Google" open={platformOpen} onOpen={setPlatformOpen}>
                  <PlatformGoogleCard client={client} />
                </Fold>
                <Fold title="Who can be here" open={whoOpen} onOpen={setWhoOpen}>
                  <WhoCard />
                </Fold>
              </>
            )
          : null}
        {staff
          ? (
              <Fold title="Spend" open={spendOpen} onOpen={setSpendOpen}>
                <SpendCard agents={session?.role === "admin" ? null : session?.agents ?? []} client={client} framed={false} />
              </Fold>
            )
          : null}
      </main>
    </FoldGroup>
  );
}
