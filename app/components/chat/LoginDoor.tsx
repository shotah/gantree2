"use client";

import { useEffect, useState } from "react";
import { chipClass } from "../shared/PageHeader";
import { TreeMark } from "../shared/TreeMark";
import { isIos, isStandalone, signInHint } from "@/app/lib/install";
import { loginHref } from "@/app/lib/login";
import { parseSlug } from "@/lib/chat/slug";

const FEATURES = [
  { label: "Agents you run", dot: "bg-ok", tone: "border-ok/40 bg-ok/10" },
  { label: "Eleven tools", dot: "bg-info", tone: "border-info/40 bg-info/10" },
  { label: "On Cloudflare or at home", dot: "bg-accent", tone: "border-accent-line bg-accent-soft" },
] as const;

const googleButtonClass = "inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-canvas shadow-md shadow-accent/30 hover:bg-accent-hover";

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden>
      <path
        fill="currentColor"
        d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.174-6.806 5.174-4.095 0-7.439-3.389-7.439-7.574S8.145 4.426 12.24 4.426c2.33 0 3.891.989 4.785 1.849l3.254-3.138C18.189 1.186 15.479 0 12.24 0c-6.635 0-12 5.365-12 12s5.365 12 12 12c6.926 0 11.52-4.869 11.52-11.726 0-.788-.085-1.39-.189-1.989H12.24z"
      />
    </svg>
  );
}

type Me = { sub: string; email?: string | null; role?: string; agents?: string[] };

export function LoginDoor() {
  const [hint, setHint] = useState("");
  const [href, setHref] = useState("/api/auth/google");
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const slug = parseSlug(new URLSearchParams(window.location.search).get("slug") ?? "");
    setHref(loginHref(slug ? `/chat/${slug}` : "/"));
    setHint(signInHint({
      ios: isIos(navigator),
      standalone: isStandalone(window, navigator),
      retry: false,
    }));
    void fetch("/api/auth/me")
      .then(async (r) => (r.ok ? r.json<Me>() : null))
      .then((body) => {
        setMe(body);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, []);

  return (
    <main
      className="relative flex h-full flex-col items-center justify-center gap-6 bg-canvas px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      data-shot="login"
    >
      <section className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-accent-soft via-panel to-panel px-5 py-6 shadow-[0_1px_0_0_var(--line)_inset]">
        <span aria-hidden className="pointer-events-none absolute -right-8 -top-14 h-40 w-40 rounded-full bg-accent/20 blur-3xl" />
        <span aria-hidden className="pointer-events-none absolute -bottom-14 left-4 h-36 w-36 rounded-full bg-info/15 blur-3xl" />
        <div className="relative flex flex-col items-center gap-4 text-center">
          <span className="grid h-20 w-20 place-items-center rounded-2xl bg-canvas/80 text-fg ring-1 ring-accent-line shadow-[0_0_32px_-10px_var(--accent)]">
            <TreeMark className="h-16 w-16" title="gantree" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-semibold tracking-tight text-mark">gantree</p>
            <h1 className="text-balance text-xl font-semibold tracking-tight text-fg">
              Your agents. Your tools. One door.
            </h1>
          </div>
          {me
            ? (
                <p className="max-w-sm text-center text-sm text-muted">
                  Signed in{me.email ? ` as ${me.email}` : ""}.
                  {me.agents?.length ? ` Agents: ${me.agents.join(", ")}.` : ""}
                </p>
              )
            : (
                <p className="max-w-sm text-center text-sm text-muted">
                  Sign in with Google. The list says which agents you can open.
                </p>
              )}
          <ul className="flex flex-wrap justify-center gap-2">
            {FEATURES.map((feature) => (
              <li key={feature.label} className={`${chipClass} ${feature.tone} text-body`}>
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${feature.dot}`} />
                {feature.label}
              </li>
            ))}
          </ul>
          {!me && ready
            ? (
                <a className={googleButtonClass} href={href}>
                  <GoogleGlyph />
                  Continue with Google
                </a>
              )
            : null}
          {!me && ready && hint
            ? <p className="max-w-sm text-center text-xs text-dim">{hint}</p>
            : null}
        </div>
      </section>
    </main>
  );
}
