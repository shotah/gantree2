"use client";

import { useState } from "react";
import { agentsMessage, codeOf, getStatus, patchConfig, restartAgent, setAgentEnabled, type ApiClient } from "@/app/lib/agentsHttp";
import type { AgentConfigView } from "@/lib/agents/types";
import { IDLE_HOURS_MAX, IDLE_HOURS_MIN } from "@/lib/agents/idle";
import { inputClass, labelClass, primaryClass } from "./Fold";
import { api } from "@/app/lib/api";
import type { AgentStatus, BrainState, PluginStatus } from "@/lib/agents/types";
import { Fold, quietClass } from "./Fold";
import { relativeTime, timeStamp } from "./relativeTime";

function stateLabel(state: BrainState | undefined): string {
  if (state === "needs_keys") {
    return "needs keys";
  }
  if (state === "ready" || state === "error" || state === "starting") {
    return state;
  }
  return "unknown";
}

function dotClass(state: BrainState | undefined): string {
  if (state === "ready") {
    return "bg-ok";
  }
  if (state === "needs_keys") {
    return "bg-amber-500";
  }
  if (state === "error") {
    return "bg-danger";
  }
  return "bg-faint";
}

function reasonText(reason: string | undefined): string {
  if (reason === "no_key") {
    return "no key";
  }
  if (reason === "disabled") {
    return "off";
  }
  if (reason === "no_oauth") {
    return "no login";
  }
  if (!reason) {
    return "skipped";
  }
  return reason.replaceAll("_", " ");
}

function ReadyLine({ plugins }: { plugins: readonly PluginStatus[] }) {
  const names = plugins.filter((plugin) => plugin.state === "ready").map((plugin) => plugin.name);
  return (
    <p>
      ready:{" "}
      {names.length === 0
        ? "—"
        : names.map((name, index) => (
            <span key={name}>{index > 0 ? ", " : ""}{name}</span>
          ))}
    </p>
  );
}

function SkippedLine({ plugins }: { plugins: readonly PluginStatus[] }) {
  const skipped = plugins.filter((plugin) => plugin.state === "skipped");
  return (
    <p>
      skipped:{" "}
      {skipped.length === 0
        ? "—"
        : skipped.map((plugin, index) => (
            <span key={`${plugin.name}-${String(index)}`}>
              {index > 0 ? ", " : ""}
              {plugin.name} ({reasonText(plugin.reason)})
            </span>
          ))}
    </p>
  );
}

export function StatusFold({
  slug,
  status,
  enabled = true,
  idleHours = 48,
  canMutate = true,
  client = api,
  onEnabled,
  onConfig,
}: {
  slug?: string;
  status: AgentStatus | null;
  enabled?: boolean;
  idleHours?: number;
  canMutate?: boolean;
  client?: ApiClient;
  onEnabled?: (enabled: boolean) => void;
  onConfig?: (config: AgentConfigView) => void;
}) {
  const [open, setOpen] = useState(true);
  const [fetched, setFetched] = useState<AgentStatus | null>(null);
  const [seen, setSeen] = useState(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idleDraft, setIdleDraft] = useState(String(idleHours));
  const [idleSeen, setIdleSeen] = useState(idleHours);
  if (idleHours !== idleSeen) {
    setIdleSeen(idleHours);
    setIdleDraft(String(idleHours));
  }
  if (status !== seen) {
    setSeen(status);
    setFetched(null);
  }
  const live = fetched ?? status;
  const label = stateLabel(live?.state);

  async function restart() {
    if (!slug || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await restartAgent(slug, client);
      setFetched(await getStatus(slug, client));
    } catch (err) {
      setError(codeOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveIdleHours() {
    if (!slug || busy || !canMutate || !onConfig) {
      return;
    }
    const parsed = Number.parseInt(idleDraft, 10);
    if (!Number.isInteger(parsed) || parsed < IDLE_HOURS_MIN || parsed > IDLE_HOURS_MAX) {
      setError("bad_config");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onConfig(await patchConfig(slug, { idleHours: parsed }, client));
    } catch (err) {
      setError(codeOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(next: boolean) {
    if (!slug || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const card = await setAgentEnabled(slug, next, client);
      onEnabled?.(card.enabled);
      if (next) {
        setFetched(await getStatus(slug, client));
      } else {
        setFetched(null);
      }
    } catch (err) {
      setError(codeOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Fold title="Status" open={open} onOpen={setOpen} hint={label}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass(live?.state)}`} />
        <span className="text-fg">{label}</span>
        {live?.version
          ? <span className="text-xs text-dim">{live.version}</span>
          : null}
        {live?.since != null
          ? <time dateTime={timeStamp(live.since)} className="text-xs text-dim">since {relativeTime(live.since)}</time>
          : null}
      </div>
      {live?.lastError
        ? (
            <p aria-label="Last error" className="mt-1 break-words font-mono text-xs text-danger">
              <time dateTime={live.lastError.at} className="mr-2 text-dim">{live.lastError.at}</time> {live.lastError.message}
            </p>
          )
        : null}
      {live
        ? (
            <>
              <p className="mt-2 text-xs text-muted">
                Last turn <time dateTime={timeStamp(live.lastTurnAt)}>{relativeTime(live.lastTurnAt)}</time>
              </p>
              <div className="mt-2 space-y-1 text-sm text-body">
                <ReadyLine plugins={live.plugins} />
                <SkippedLine plugins={live.plugins} />
              </div>
            </>
          )
        : <p className="mt-2 text-sm text-muted">No status yet.</p>}
      {slug
        ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className={quietClass} disabled={busy} onClick={() => void restart()}>
                Restart
              </button>
              <button
                type="button"
                className={quietClass}
                disabled={busy}
                onClick={() => void toggleEnabled(!enabled)}
              >
                {enabled ? "Turn off" : "Turn on"}
              </button>
              <p className="w-full text-xs text-dim">
                {enabled ? "reloads tools, chat stays" : "stopped — chat and schedules are paused"}
              </p>
              <div className="mt-3 w-full max-w-xs">
                <label htmlFor="idle-hours" className={`${labelClass} mb-1 block`}>Stop after</label>
                <div className="flex items-center gap-2">
                  <input
                    id="idle-hours"
                    type="number"
                    min={IDLE_HOURS_MIN}
                    max={IDLE_HOURS_MAX}
                    step={1}
                    value={idleDraft}
                    disabled={!canMutate || busy}
                    onChange={(e) => {
                      setIdleDraft(e.target.value);
                      setError(null);
                    }}
                    className={`${inputClass} w-24`}
                  />
                  <span className="text-sm text-body">hours</span>
                </div>
                <p className="mt-1 text-xs text-dim">
                  Stops this agent when no person has messaged it for this long. 48 is the default.
                </p>
                {canMutate && onConfig
                  ? (
                      <button type="button" disabled={busy} onClick={() => void saveIdleHours()} className={`${primaryClass} mt-2`}>
                        Save
                      </button>
                    )
                  : null}
              </div>
              {error ? <p role="alert" className="mt-2 text-xs text-danger">{agentsMessage(error)}</p> : null}
            </div>
          )
        : null}
    </Fold>
  );
}
