"use client";

import { useState } from "react";
import { actContainer, agentsMessage, codeOf, type ApiClient } from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import type { AgentRuntime, AgentStatus, ContainerInfo } from "@/lib/agents/types";
import { alertClass, Fold, quietClass } from "./Fold";
import { relativeTime, timeStamp } from "./relativeTime";

const ACTIONS = ["start", "stop", "recreate"] as const;

export function StatusFold({
  slug,
  status,
  container,
  canMutate,
  runtime = "container",
  client = api,
  onContainer,
}: {
  slug: string;
  status: AgentStatus | null;
  container: ContainerInfo | null;
  canMutate: boolean;
  runtime?: AgentRuntime;
  client?: ApiClient;
  onContainer: (info: ContainerInfo) => void;
}) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const harness = status ? status.harness : "unknown";
  const state = container ? container.state : "unknown";
  const native = runtime === "native";

  async function act(action: (typeof ACTIONS)[number]) {
    setBusy(true);
    setError(null);
    try {
      onContainer(await actContainer(slug, action, client));
    } catch (err) {
      setError(codeOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Fold title="Status" open={open} onOpen={setOpen} hint={`${harness} · ${native ? "native" : state}`}>
      {error ? <p role="alert" className={`${alertClass} mb-3`}>{agentsMessage(error)}</p> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${harness === "connected" ? "bg-ok" : "bg-faint"}`} />
        <span className="text-fg">{harness}</span>
        {status?.since != null
          ? <time dateTime={timeStamp(status.since)} className="text-xs text-dim">since {relativeTime(status.since)}</time>
          : null}
      </div>
      {native
        ? <p className="mt-2 text-sm text-body">native</p>
        : (
            <p className="mt-2 text-sm text-body">
              Container <span className="text-fg">{state}</span>
              {container?.lastError ? <span className="ml-2 text-xs text-danger">{container.lastError}</span> : null}
            </p>
          )}
      {status?.lastError
        ? (
            <p aria-label="Harness last error" className="mt-1 break-words font-mono text-xs text-danger">
              <time dateTime={status.lastError.at} className="mr-2 text-dim">{status.lastError.at}</time>
              {status.lastError.message}
            </p>
          )
        : null}
      {status
        ? (
            <p className="mt-2 text-xs text-muted">
              Last turn <time dateTime={timeStamp(status.lastTurn)}>{relativeTime(status.lastTurn)}</time>
            </p>
          )
        : <p className="mt-2 text-sm text-muted">Harness has not reported yet.</p>}
      {canMutate && !native
        ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {ACTIONS.map((action) => (
                <button
                  key={action}
                  type="button"
                  disabled={busy}
                  aria-label={`${action} container`}
                  onClick={() => void act(action)}
                  className={`${quietClass} capitalize`}
                >
                  {action}
                </button>
              ))}
            </div>
          )
        : null}
      {status
        ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <h3 className="text-xs font-medium text-fg">Published</h3>
                {status.published.length === 0
                  ? <p className="mt-1 text-xs text-dim">Nothing published.</p>
                  : (
                      <ul aria-label="Published" className="mt-1 space-y-1 text-sm text-body">
                        {status.published.map((name) => <li key={name}>{name}</li>)}
                      </ul>
                    )}
              </div>
              <div>
                <h3 className="text-xs font-medium text-fg">Skipped</h3>
                {status.skipped.length === 0
                  ? <p className="mt-1 text-xs text-dim">Nothing skipped.</p>
                  : (
                      <ul aria-label="Skipped" className="mt-1 space-y-1 text-sm text-danger">
                        {status.skipped.map((item) => (
                          <li key={item.name}>{item.name}: {item.reason}</li>
                        ))}
                      </ul>
                    )}
              </div>
            </div>
          )
        : null}
    </Fold>
  );
}
