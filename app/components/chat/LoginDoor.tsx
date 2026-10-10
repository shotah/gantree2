"use client";

import { useEffect, useState } from "react";
import { ThemeSelect } from "../shared/ThemeSelect";
import { isIos, isStandalone, signInHint } from "@/app/lib/install";
import { loginHref } from "@/app/lib/login";
import { parseSlug } from "@/lib/chat/slug";

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
      className="flex h-full flex-col items-center justify-center gap-6 bg-canvas px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      data-shot="login"
    >
      <div className="absolute right-4 top-[calc(env(safe-area-inset-top)+1rem)]">
        <ThemeSelect />
      </div>
      <img src="/icon.svg" alt="" className="h-16 w-16" />
      <h1 className="text-xl font-medium text-fg">gantree</h1>
      {me
        ? (
            <p className="max-w-sm text-center text-sm text-muted">
              Signed in{me.email ? ` as ${me.email}` : ""}.
              {me.agents?.length ? ` Agents: ${me.agents.join(", ")}.` : ""}
            </p>
          )
        : (
            <>
              <p className="max-w-sm text-center text-sm text-muted">
                Sign in with Google. The list says which agents you can open.
              </p>
              {ready
                ? (
                    <a
                      className="rounded-xl border border-accent-line bg-accent-soft px-4 py-2 text-sm text-mark"
                      href={href}
                    >
                      Continue with Google
                    </a>
                  )
                : null}
              {ready && hint
                ? <p className="max-w-sm text-center text-xs text-dim">{hint}</p>
                : null}
            </>
          )}
    </main>
  );
}
