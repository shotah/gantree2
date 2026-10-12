"use client";

import { useState } from "react";
import { agentsMessage, codeOf, deleteAgent, setAgentEnabled } from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import { displaySlug } from "@/lib/avatar/store";

const DESTROY_WARN
  = "This will delete EVERYTHING — chat, keys, memory, and the durable object — and cannot be undone. Are you sure?";

export function AgentRoomControls({ slug }: { slug: string }) {
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [destroyStep, setDestroyStep] = useState(false);
  const label = displaySlug(slug);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const card = await setAgentEnabled(slug, next, api);
      setEnabled(card.enabled);
    } catch (err) {
      setError(codeOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    setBusy(true);
    setError(null);
    try {
      await deleteAgent(slug, api);
      window.location.assign("/chat");
    } catch (err) {
      setError(codeOf(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2">
      <span className="text-xs text-muted">This agent ({label})</span>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded-lg border border-line bg-canvas/60 px-2.5 py-1 text-xs text-body hover:border-accent-line disabled:opacity-50"
          onClick={() => void toggle(!enabled)}
        >
          {enabled ? "Turn off" : "Turn on"}
        </button>
      </div>
      {enabled
        ? null
        : <p className="text-[11px] text-dim">stopped — chat and schedules are paused</p>}
      <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-danger-line/60 bg-danger-soft/30 px-2.5 py-2">
        <span className="text-xs font-medium text-danger">Destroy agent</span>
        <label className="flex flex-col gap-1 text-[11px] text-muted">
          Type the agent ID to continue
          <input
            value={confirm}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded border border-edge bg-canvas px-1.5 py-1 text-sm text-fg"
            onChange={(e) => {
              setConfirm(e.target.value);
              if (destroyStep && e.target.value !== slug) {
                setDestroyStep(false);
              }
            }}
          />
        </label>
        <button
          type="button"
          disabled={busy || confirm !== slug || destroyStep}
          className="rounded-lg border border-danger-line bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger disabled:opacity-50"
          onClick={() => setDestroyStep(true)}
        >
          {`Delete ${label}`}
        </button>
        {destroyStep
          ? (
              <>
                <p className="text-[11px] text-body">{DESTROY_WARN}</p>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-lg border border-danger-line bg-danger px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                  onClick={() => void destroy()}
                >
                  {`Destroy ${label}`}
                </button>
              </>
            )
          : null}
      </div>
      {error ? <p role="alert" className="text-[11px] text-danger">{agentsMessage(error)}</p> : null}
    </div>
  );
}
