"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cardClass, chipClass, PageHeader } from "@/app/components/shared/PageHeader";
import { USERS_URL, api, userUrl } from "@/app/lib/api";
import { formatEntry } from "@/lib/door/allowlist";
import type { AuditEvent } from "@/lib/door/settingsStore";
import type { Role, UserRow } from "@/lib/door/users";

export type ApiClient = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const ROLES: Role[] = ["admin", "operator", "member"];

const ROLE_BLURB: Record<Role, string> = {
  admin: "Users, settings, and every agent. Chat is Who can chat on the agent.",
  operator: "The agents listed on their row.",
  member: "Sign in, and chat where an agent allows them.",
};

/** Chip colours plus the solid bar for that role. One map for every role mark. */
const ROLE_TONE: Record<Role, { tone: string; bar: string }> = {
  admin: { tone: "text-ok border-ok/40 bg-ok/10", bar: "bg-ok" },
  operator: { tone: "text-info border-info/40 bg-info/10", bar: "bg-info" },
  member: { tone: "text-mark border-accent-line bg-accent-soft", bar: "bg-mark" },
};

const COPY: Record<string, string> = {
  forbidden: "Only an admin can change users.",
  locked: "That person is set in the environment and stays locked.",
  bad_entry: "Use an email or sub:email.",
  bad_role: "Role must be admin, operator, or member.",
  bad_agents: "Agent names use lowercase letters, digits, and hyphens.",
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

const fieldClass = "rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-body outline-none focus-visible:border-accent-line focus-visible:ring-2 focus-visible:ring-accent/40";
const primaryClass = "rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-canvas hover:bg-accent-hover disabled:opacity-50";
const saveClass = "rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-canvas hover:bg-accent-hover disabled:opacity-50";
const quietClass = "rounded-xl border border-line bg-canvas px-3 py-1.5 text-xs font-medium text-body hover:bg-track disabled:opacity-50";
const ghostClass = "rounded-xl border border-line px-3 py-1.5 text-xs text-dim hover:bg-track disabled:opacity-50";
const dangerClass = "rounded-xl border border-danger-line bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger disabled:opacity-50";

export function roleTone(role: Role): string {
  return ROLE_TONE[role].tone;
}

function message(code: string): string {
  return COPY[code] ?? code;
}

function isRole(value: string): value is Role {
  return value === "admin" || value === "operator" || value === "member";
}

function agentTokens(raw: string): string[] {
  return raw.split(/[\s,]+/).map((part) => part.trim().toLowerCase()).filter(Boolean);
}

function roleStoresAgents(role: Role): boolean {
  return role === "admin" || role === "operator";
}

/** The avatar letter: the email's, so a `sub:email` row does not read as a digit. */
export function initial(entry: { email: string | null }, label: string): string {
  const char = (entry.email ?? label).trim().charAt(0);
  return char ? char.toUpperCase() : "?";
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

function LockGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3.25" y="7" width="9.5" height="6.25" rx="1.2" />
      <path d="M5.25 7V5.25a2.75 2.75 0 0 1 5.5 0V7" strokeLinecap="round" />
    </svg>
  );
}

function RoleGlyph({ role }: { role: Role }) {
  const pen = "h-4 w-4";
  if (role === "admin") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" className={pen} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinejoin="round" d="M12 3.5 19 6.2v5.4c0 4.2-2.9 7.2-7 8.9-4.1-1.7-7-4.7-7-8.9V6.2L12 3.5Z" />
      </svg>
    );
  }
  if (role === "operator") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" className={pen} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M4 8h10M18 8h2M4 16h2M10 16h10" />
        <circle cx="16" cy="8" r="2" />
        <circle cx="8" cy="16" r="2" />
      </svg>
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={pen} fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8.5" r="3" />
      <path strokeLinecap="round" d="M6.5 19.5c.7-3 2.9-4.5 5.5-4.5s4.8 1.5 5.5 4.5" />
    </svg>
  );
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
      className={fieldClass}
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
      <PageHeader
        title="Users"
        blurb="Who may sign in, and as what. Environment rows stay locked."
        nav={[
          { href: "/agents", label: "Agents" },
          { href: "/settings", label: "Settings" },
        ]}
      />

      <ul className="grid gap-3 sm:grid-cols-3" aria-label="Roles">
        {ROLES.map((item) => (
          <li key={item} className={`${cardClass} relative overflow-hidden`}>
            <span aria-hidden className={`pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full opacity-30 blur-2xl ${ROLE_TONE[item].bar}`} />
            <span aria-hidden className={`absolute inset-x-0 top-0 h-1.5 ${ROLE_TONE[item].bar}`} />
            <div className="relative">
              <div className="flex items-center gap-2.5">
                <span aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${roleTone(item)}`}>
                  <RoleGlyph role={item} />
                </span>
                <span className={`${chipClass} ${roleTone(item)}`}>{item}</span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-dim">{ROLE_BLURB[item]}</p>
            </div>
          </li>
        ))}
      </ul>

      {error
        ? <p role="alert" className="rounded-2xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger">{message(error)}</p>
        : null}
      {notice
        ? <p role="status" className="rounded-2xl border border-ok/40 bg-ok/10 px-4 py-3 text-sm font-medium text-ok">{notice}</p>
        : null}

      {phase === "loading"
        ? (
            <p className={`${cardClass} flex items-center gap-2 text-sm text-muted`}>
              <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-accent" />
              Loading users.
            </p>
          )
        : null}

      {phase === "denied"
        ? null
        : phase === "ready"
          ? (
              <>
                <form
                  aria-label="Add a user"
                  className={`${cardClass} flex flex-col gap-3`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const saved = entry.trim();
                    if (!saved || busy) {
                      return;
                    }
                    void submit(
                      { entry: saved, role, agents: roleStoresAgents(role) ? agentTokens(agents) : [] },
                      saved,
                      true,
                    );
                  }}
                >
                  <h2 className="text-sm font-semibold text-fg">Add someone</h2>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="user-entry" className="text-xs text-muted">Email or sub:email</label>
                    <input
                      id="user-entry"
                      value={entry}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="bob@example.com"
                      onChange={(e) => setEntry(e.target.value)}
                      className={fieldClass}
                    />
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex flex-col gap-1">
                      <label htmlFor="user-role" className="text-xs text-muted">Role</label>
                      <RoleSelect id="user-role" value={role} disabled={busy} onChange={setRole} />
                    </div>
                    {roleStoresAgents(role)
                      ? (
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <label htmlFor="user-agents" className="text-xs text-muted">Agents</label>
                            <input
                              id="user-agents"
                              value={agents}
                              autoComplete="off"
                              spellCheck={false}
                              placeholder="ada, bob"
                              onChange={(e) => setAgents(e.target.value)}
                              className={fieldClass}
                            />
                          </div>
                        )
                      : null}
                    <button
                      type="submit"
                      disabled={busy || entry.trim().length === 0}
                      className={primaryClass}
                    >
                      Add user
                    </button>
                  </div>
                </form>

                <ul className="space-y-3" aria-label="Users">
                  {users.map((user) => {
                    const label = formatEntry(user.entry);
                    const open = editing === label;
                    return (
                      <li key={label} aria-label={label} className={`${cardClass} relative overflow-hidden text-sm`}>
                        <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${ROLE_TONE[user.role].bar}`} />
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-mark text-sm font-bold text-canvas">
                              {initial(user.entry, label)}
                            </span>
                            <div className="min-w-0">
                              <span className="break-all font-medium text-fg">{label}</span>
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                <span className={`${chipClass} ${roleTone(user.role)}`}>{user.role}</span>
                                {user.locked
                                  ? (
                                      <span className={`${chipClass} border-line text-dim`}>
                                        <LockGlyph />
                                        locked
                                      </span>
                                    )
                                  : null}
                                {user.agents.map((slug, index) => (
                                  <span key={`${slug}-${index}`} className={`${chipClass} border-accent-line bg-accent-soft text-mark`}>{slug}</span>
                                ))}
                              </div>
                            </div>
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
                                          className={quietClass}
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
                                            className={dangerClass}
                                          >
                                            Confirm remove
                                          </button>
                                          <button
                                            type="button"
                                            aria-label={`Cancel remove ${label}`}
                                            disabled={busy}
                                            onClick={() => setConfirming(null)}
                                            className={ghostClass}
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
                                          className={quietClass}
                                        >
                                          Remove
                                        </button>
                                      )}
                                </div>
                              )}
                        </div>
                        {open
                          ? (
                              <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
                                <div className="flex flex-col gap-1">
                                  <label htmlFor={`role-${label}`} className="text-xs text-muted">Role for {label}</label>
                                  <RoleSelect id={`role-${label}`} value={editRole} disabled={busy} onChange={setEditRole} />
                                </div>
                                {roleStoresAgents(editRole)
                                  ? (
                                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                                        <label htmlFor={`agents-${label}`} className="text-xs text-muted">Agents for {label}</label>
                                        <input
                                          id={`agents-${label}`}
                                          value={editAgents}
                                          autoComplete="off"
                                          spellCheck={false}
                                          onChange={(e) => setEditAgents(e.target.value)}
                                          className={fieldClass}
                                        />
                                      </div>
                                    )
                                  : null}
                                <button
                                  type="button"
                                  aria-label={`Save ${label}`}
                                  disabled={busy}
                                  onClick={() => void submit(
                                    {
                                      entry: label,
                                      role: editRole,
                                      agents: roleStoresAgents(editRole) ? agentTokens(editAgents) : [],
                                    },
                                    label,
                                  )}
                                  className={saveClass}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Cancel ${label}`}
                                  disabled={busy}
                                  onClick={() => setEditing(null)}
                                  className={ghostClass}
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

                <section aria-label="Audit" className={cardClass}>
                  <h2 className="text-sm font-semibold text-fg">Audit</h2>
                  {audit.length === 0
                    ? <p className="mt-3 text-xs text-dim">No changes yet.</p>
                    : (
                        <ol className="mt-4 text-xs text-body">
                          {audit.map((event, index) => (
                            <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                              <span aria-hidden className={`absolute left-[3px] top-1 w-px bg-line ${index === audit.length - 1 ? "h-2" : "bottom-0"}`} />
                              <span aria-hidden className="relative z-10 mt-0.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                              <div className="flex min-w-0 flex-wrap gap-x-2 break-all">
                                <time dateTime={stamp(event.at)?.toISOString()} className="text-dim">{formatWhen(event.at)}</time>
                                <span className="text-muted">{event.who}</span>
                                <span>{summary(event)}</span>
                              </div>
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
