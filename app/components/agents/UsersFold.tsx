"use client";

import { useState, type SubmitEvent } from "react";
import { agentsMessage, codeOf, putRoomUsers, type ApiClient } from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import type { RoomUser } from "@/lib/chat/allow";
import { alertClass, Fold, inputClass, labelClass, primaryClass, quietClass } from "./Fold";

export function cleanEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

function labelOf(user: RoomUser): string {
  return user.email ?? user.sub ?? "unknown";
}

export function UsersFold({
  slug,
  users,
  canMutate,
  client = api,
  onUsers,
}: {
  slug: string;
  users: RoomUser[];
  canMutate: boolean;
  client?: ApiClient;
  onUsers: (users: RoomUser[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: RoomUser[], clear: boolean) {
    setBusy(true);
    setError(null);
    try {
      onUsers(await putRoomUsers(slug, next, client));
      if (clear) {
        setEmail("");
      }
    } catch (err) {
      setError(codeOf(err));
    } finally {
      setBusy(false);
    }
  }

  function add(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const nextEmail = cleanEmail(email);
    if (!nextEmail) {
      setError("Use an email address.");
      return;
    }
    if (users.some((user) => user.email === nextEmail)) {
      setError("That email is already on the list.");
      return;
    }
    void save([...users, { email: nextEmail }], true);
  }

  return (
    <Fold title="Who can chat" open={open} onOpen={setOpen} hint={`${users.length}`}>
      <p className="mb-3 text-sm text-muted">Members can chat with this agent only when they are on this list.</p>
      {error ? <p role="alert" className={`${alertClass} mb-3`}>{agentsMessage(error)}</p> : null}
      {users.length === 0
        ? <p className="text-sm text-muted">Nobody on the list yet.</p>
        : (
            <ul aria-label="Chat access" className="space-y-2">
              {users.map((user) => {
                const label = labelOf(user);
                return (
                  <li key={label} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      <span className="text-fg">{label}</span>
                      {user.email && user.sub ? <span className="ml-2 text-xs text-dim">{user.sub}</span> : null}
                    </span>
                    {canMutate
                      ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void save(users.filter((item) => item !== user), false)}
                            className={quietClass}
                          >
                            Remove {label}
                          </button>
                        )
                      : null}
                  </li>
                );
              })}
            </ul>
          )}
      {canMutate
        ? (
            <form aria-label="Add chat access" className="mt-4 flex flex-wrap items-end gap-2" onSubmit={add}>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="room-email" className={labelClass}>Email</label>
                <input
                  id="room-email"
                  value={email}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ada@example.com"
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                />
              </div>
              <button type="submit" disabled={busy} className={primaryClass}>Add email</button>
            </form>
          )
        : null}
    </Fold>
  );
}
