"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeSelect } from "@/app/components/shared/ThemeSelect";
import { USERS_URL, api, userUrl } from "@/app/lib/api";
import { formatEntry } from "@/lib/door/allowlist";
import type { AuditEvent } from "@/lib/door/settingsStore";
import type { Role, UserRow } from "@/lib/door/users";

export type ApiClient = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const ROLES: Role[] = ["admin", "operator", "member"];

const ROLE_BLURB: Record<Role, string> = {
  admin: "Users, settings, and every agent.",
  operator: "The agents listed on their row.",
  member: "Sign in, and chat where an agent allows them.",
};

const COPY: Record<string, string> = {
  forbidden: "Only an admin can change users.",
  locked: "That person is set in the environment and stays locked.",
  bad_entry: "Use an email or sub:email.",
  bad_role: "Role must be admin, operator, or member.",
  bad_agents: "Agent slugs use lowercase letters, digits, and hyphens.",
  not_found: "That person is not on the stored list.",
  settings_unavailable: "User storage is not configured.",
  bad_json: "That request was not valid JSON.",
  unauthorized: "Sign in again.",
  request_failed: "Could not reach users. Try again.",
};

const VERB: Record<string, string> = {
  "user.add": "added",
  "user.update": "updated",
  "user.remove": "removed",
};

function message(code: string): string {
  return COPY[code] ?? code;
}

function isRole(value: string): value is Role {
  return value === "admin" || value === "operator" || value === "member";
}

function agentTokens(raw: string): string[] {
  return raw.split(/[\s,]+/).map((part) => part.trim().toLowerCase()).filter(Boolean);
}

async function errorCode(res: Response): Promise<string> {
  try {
    const body = await res.json<{ error?: unknown }>();
    return typeof body.error === "string" ? body.error : "request_failed";
  } catch {
    return "request_failed";
  }
}

function stamp(at: number): Date | null {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatWhen(at: number): string {
  const date = stamp(at);
  return date ? date.toISOString().slice(0, 16).replace("T", " ") : String(at);
}

function summary(event: AuditEvent): string {
  const verb = VERB[event.action] ?? event.action;
  try {
    const detail = JSON.parse(event.detail) as { entry?: unknown; role?: unknown; agents?: unknown };
    const entry = typeof detail.entry === "string" ? detail.entry : "";
    const role = typeof detail.role === "string" ? detail.role : "";
    const agents = Array.isArray(detail.agents) ? detail.agents.filter((item): item is string => typeof item === "string") : [];
    const core = [entry, role].filter(Boolean).join(" ");
    const tail = agents.length > 0 ? ` [${agents.join(", ")}]` : "";
    return `${verb} ${core}${tail}`.trim();
  } catch {
    return `${verb} ${event.detail}`.trim();
  }
}

function RoleSelect({ id, value, onChange, disabled }: { id: string; value: Role; onChange: (role: Role) => void; disabled: boolean }) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        if (isRole(e.target.value)) {
          onChange(e.target.value);
        }
      }}
      className="rounded border border-line bg-canvas px-2 py-1.5 text-sm text-body"
    >
      {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
    </select>
  );
}

export function UsersScreen({ client = api }: { client?: ApiClient }) {
  const mounted = useRef(true);
  const [phase, setPhase] = useState<"loading" | "ready" | "denied">("loading");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [entry, setEntry] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [agents, setAgents] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<Role>("member");
  const [editAgents, setEditAgents] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const res = await client(USERS_URL);
      if (!mounted.current) {
        return;
      }
      if (res.status === 403) {
        setPhase("denied");
        setError("forbidden");
        return;
      }
      if (!res.ok) {
        setError(await errorCode(res));
        setPhase("ready");
        return;
      }
      const body = await res.json<{ users?: UserRow[]; audit?: AuditEvent[] }>();
      if (!mounted.current) {
        return;
      }
      setUsers(Array.isArray(body.users) ? body.users : []);
      setAudit(Array.isArray(body.audit) ? body.audit : []);
      setError(null);
      setPhase("ready");
    } catch {
      if (!mounted.current) {
        return;
      }
      setError("request_failed");
      setPhase("ready");
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit(body: { entry: string; role: Role; agents: string[] }, saved: string, resetAdd = false) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await client(USERS_URL, { method: "POST", body: JSON.stringify(body) });
      if (!mounted.current) {
        return;
      }
      if (!res.ok) {
        setError(await errorCode(res));
        return;
      }
      if (resetAdd) {
        setEntry("");
        setAgents("");
        setRole("member");
      }
      setNotice(`Saved ${saved}.`);
      setEditing(null);
      setConfirming(null);
      await refresh();
    } catch {
      if (mounted.current) {
        setError("request_failed");
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  async function remove(label: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await client(userUrl(label), { method: "DELETE" });
      if (!mounted.current) {
        return;
      }
      if (!res.ok) {
        setError(await errorCode(res));
        return;
      }
      setNotice(`Removed ${label}.`);
      setConfirming(null);
      setEditing(null);
      await refresh();
    } catch {
      if (mounted.current) {
        setError("request_failed");
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <a href="/" className="text-sm text-muted hover:text-body">gantree</a>
          <h1 className="text-2xl font-semibold text-fg">Users</h1>
          <p className="text-sm text-muted">Who may sign in, and as what. Environment rows stay locked.</p>
        </div>
        <div className="w-40 shrink-0">
          <ThemeSelect />
        </div>
      </header>

      <ul className="grid gap-3 text-sm sm:grid-cols-3" aria-label="Roles">
        {ROLES.map((item) => (
          <li key={item} className="rounded border border-line px-3 py-2">
            <p className="font-medium text-fg">{item}</p>
            <p className="mt-1 text-xs text-dim">{ROLE_BLURB[item]}</p>
          </li>
        ))}
      </ul>

      {error
        ? <p role="alert" className="rounded border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">{message(error)}</p>
        : null}
      {notice
        ? <p role="status" className="text-sm text-body">{notice}</p>
        : null}

      {phase === "loading"
        ? <p className="text-sm text-muted">Loading users.</p>
        : null}

      {phase === "denied"
        ? null
        : phase === "ready"
          ? (
              <>
                <form
                  aria-label="Add a user"
                  className="flex flex-col gap-3 rounded border border-line bg-panel px-4 py-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const saved = entry.trim();
                    if (!saved || busy) {
                      return;
                    }
                    void submit(
                      { entry: saved, role, agents: role === "operator" ? agentTokens(agents) : [] },
                      saved,
                      true,
                    );
                  }}
                >
                  <div className="flex flex-col gap-1">
                    <label htmlFor="user-entry" className="text-xs text-muted">Email or sub:email</label>
                    <input
                      id="user-entry"
                      value={entry}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="bob@example.com"
                      onChange={(e) => setEntry(e.target.value)}
                      className="rounded border border-line bg-canvas px-3 py-1.5 text-sm text-body"
                    />
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1">
                      <label htmlFor="user-role" className="text-xs text-muted">Role</label>
                      <RoleSelect id="user-role" value={role} disabled={busy} onChange={setRole} />
                    </div>
                    {role === "operator"
                      ? (
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <label htmlFor="user-agents" className="text-xs text-muted">Agents</label>
                            <input
                              id="user-agents"
                              value={agents}
                              autoComplete="off"
                              spellCheck={false}
                              placeholder="kit, ada"
                              onChange={(e) => setAgents(e.target.value)}
                              className="rounded border border-line bg-canvas px-3 py-1.5 text-sm text-body"
                            />
                          </div>
                        )
                      : null}
                    <button
                      type="submit"
                      disabled={busy || entry.trim().length === 0}
                      className="rounded bg-accent px-4 py-2 text-sm font-medium text-canvas hover:bg-accent-hover disabled:opacity-50"
                    >
                      Add user
                    </button>
                  </div>
                </form>

                <ul className="space-y-2" aria-label="Users">
                  {users.map((user) => {
                    const label = formatEntry(user.entry);
                    const open = editing === label;
                    return (
                      <li key={label} aria-label={label} className="rounded border border-line px-3 py-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="break-all font-medium text-fg">{label}</span>
                            <span className="ml-2 text-xs text-dim">{user.role}</span>
                            {user.locked
                              ? <span className="ml-2 text-xs text-dim">locked</span>
                              : null}
                            {user.agents.length > 0
                              ? <span className="ml-2 text-xs text-mark">{user.agents.join(", ")}</span>
                              : null}
                          </div>
                          {user.locked
                            ? null
                            : (
                                <div className="flex flex-wrap gap-2">
                                  {open
                                    ? null
                                    : (
                                        <button
                                          type="button"
                                          aria-label={`Edit ${label}`}
                                          disabled={busy}
                                          onClick={() => {
                                            setEditing(label);
                                            setEditRole(user.role);
                                            setEditAgents(user.agents.join(", "));
                                            setConfirming(null);
                                          }}
                                          className="rounded border border-line px-2 py-1 text-xs text-body hover:bg-track disabled:opacity-50"
                                        >
                                          Edit
                                        </button>
                                      )}
                                  {confirming === label
                                    ? (
                                        <>
                                          <button
                                            type="button"
                                            aria-label={`Confirm remove ${label}`}
                                            disabled={busy}
                                            onClick={() => void remove(label)}
                                            className="rounded border border-danger-line px-2 py-1 text-xs text-danger disabled:opacity-50"
                                          >
                                            Confirm remove
                                          </button>
                                          <button
                                            type="button"
                                            aria-label={`Cancel remove ${label}`}
                                            disabled={busy}
                                            onClick={() => setConfirming(null)}
                                            className="rounded border border-line px-2 py-1 text-xs text-dim disabled:opacity-50"
                                          >
                                            Cancel
                                          </button>
                                        </>
                                      )
                                    : (
                                        <button
                                          type="button"
                                          aria-label={`Remove ${label}`}
                                          disabled={busy}
                                          onClick={() => {
                                            setConfirming(label);
                                            setEditing(null);
                                          }}
                                          className="rounded border border-line px-2 py-1 text-xs text-body hover:bg-track disabled:opacity-50"
                                        >
                                          Remove
                                        </button>
                                      )}
                                </div>
                              )}
                        </div>
                        {open
                          ? (
                              <div className="mt-3 flex flex-wrap items-end gap-2">
                                <div className="flex flex-col gap-1">
                                  <label htmlFor={`role-${label}`} className="text-xs text-muted">Role for {label}</label>
                                  <RoleSelect id={`role-${label}`} value={editRole} disabled={busy} onChange={setEditRole} />
                                </div>
                                {editRole === "operator"
                                  ? (
                                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                                        <label htmlFor={`agents-${label}`} className="text-xs text-muted">Agents for {label}</label>
                                        <input
                                          id={`agents-${label}`}
                                          value={editAgents}
                                          autoComplete="off"
                                          spellCheck={false}
                                          onChange={(e) => setEditAgents(e.target.value)}
                                          className="rounded border border-line bg-canvas px-3 py-1.5 text-sm text-body"
                                        />
                                      </div>
                                    )
                                  : null}
                                <button
                                  type="button"
                                  aria-label={`Save ${label}`}
                                  disabled={busy}
                                  onClick={() => void submit(
                                    { entry: label, role: editRole, agents: editRole === "operator" ? agentTokens(editAgents) : [] },
                                    label,
                                  )}
                                  className="rounded border border-accent-line bg-accent-soft px-3 py-1.5 text-xs font-medium text-fg disabled:opacity-50"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Cancel ${label}`}
                                  disabled={busy}
                                  onClick={() => setEditing(null)}
                                  className="rounded border border-line px-2 py-1 text-xs text-dim disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            )
                          : null}
                      </li>
                    );
                  })}
                </ul>

                <section aria-label="Audit" className="space-y-2">
                  <h2 className="text-sm font-medium text-fg">Audit</h2>
                  {audit.length === 0
                    ? <p className="text-xs text-dim">No changes yet.</p>
                    : (
                        <ol className="space-y-1 text-xs text-body">
                          {audit.map((event) => (
                            <li key={event.id} className="flex flex-wrap gap-x-2 break-all">
                              <time dateTime={stamp(event.at)?.toISOString()} className="text-dim">{formatWhen(event.at)}</time>
                              <span className="text-muted">{event.who}</span>
                              <span>{summary(event)}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                </section>
              </>
            )
          : null}
    </main>
  );
}
