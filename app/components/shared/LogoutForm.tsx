"use client";

import { type ReactNode, type SubmitEvent } from "react";
import { kvClear } from "@/app/lib/kv";

/**
 * Session logout. Drops the on-device chat cache (threads and room images),
 * then posts. A thrown clear still posts — the cookie has to go.
 */
export function LogoutForm({ children }: { children: ReactNode }) {
  function onSubmit(ev: SubmitEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    void (async () => {
      try {
        await kvClear();
      } catch {
        // IndexedDB can reject; the session cookie still has to go.
      }
      // `submit()` does not re-fire `onSubmit`, so this cannot loop.
      form.submit();
    })();
  }

  return (
    <form action="/api/auth/logout" method="post" onSubmit={onSubmit}>
      {children}
    </form>
  );
}
