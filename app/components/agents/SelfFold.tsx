"use client";

import { useEffect, useState } from "react";
import { agentsMessage, codeOf, getSelf, putSelf, type ApiClient } from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import type { AgentRuntime } from "@/lib/agents/types";
import { alertClass, Fold, primaryClass, quietClass } from "./Fold";

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

function lineLabel(line: string, index: number): string {
  const trimmed = line.trim();
  return `Remove line ${String(index + 1)}: ${trimmed === "" ? "blank" : trimmed}`;
}

export function SelfFold({
  slug,
  runtime,
  canMutate,
  client = api,
}: {
  slug: string;
  runtime: AgentRuntime;
  canMutate: boolean;
  client?: ApiClient;
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [maxChars, setMaxChars] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const native = runtime === "native";

  useEffect(() => {
    if (!open || !native) {
      return;
    }
    let gone = false;
    setError(null);
    void getSelf(slug, client).then((page) => {
      if (gone) {
        return;
      }
      setSaved(page.text);
      setDraft(page.text);
      setMaxChars(page.maxChars);
    }).catch((err: unknown) => {
      if (!gone) {
        setError(codeOf(err));
      }
    });
    return () => {
      gone = true;
    };
  }, [open, native, slug, client]);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const page = await putSelf(slug, draft, client);
      setSaved(page.text);
      setDraft(page.text);
      setMaxChars(page.maxChars);
      setNotice("Saved.");
    } catch (err) {
      setError(codeOf(err));
    } finally {
      setBusy(false);
    }
  }

  function revert() {
    if (saved === null) {
      return;
    }
    setDraft(saved);
    setNotice(null);
    setError(null);
  }

  function dropLine(index: number) {
    const lines = draft.split("\n");
    lines.splice(index, 1);
    setDraft(lines.join("\n"));
    setNotice(null);
  }

  const chars = utf8Length(draft);
  const over = maxChars > 0 && chars > maxChars;
  const lines = draft.split("\n");

  return (
    <Fold title="Self notes" open={open} onOpen={setOpen} hint={native ? undefined : "container"}>
      {error ? <p role="alert" className={`${alertClass} mb-3`}>{agentsMessage(error)}</p> : null}
      {notice ? <p role="status" className="mb-3 text-sm text-body">{notice}</p> : null}
      {native
        ? null
        : (
            <p className="text-sm text-body">
              This agent runs in a container. SELF.md is on the container disk.
            </p>
          )}
      {native && saved === null && !error ? <p className="text-sm text-muted">Loading self notes.</p> : null}
      {native && saved !== null
        ? (
            <>
              <label htmlFor="self-draft" className="mb-1 block text-xs text-muted">Self notes text</label>
              <textarea
                id="self-draft"
                value={draft}
                rows={12}
                disabled={!canMutate || busy}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setNotice(null);
                }}
                className="w-full rounded border border-line bg-canvas px-3 py-2 font-mono text-xs text-body"
              />
              <p aria-label="Self notes length" className={`mt-2 text-xs ${over ? "text-danger" : "text-dim"}`}>
                {`${String(chars)} / ${String(maxChars)}`}
              </p>
              <p className="mt-1 text-xs text-dim">Saving restores the kernel header.</p>
              <ul aria-label="Self note lines" className="mt-3 space-y-1">
                {lines.map((line, index) => (
                  <li key={`${String(index)}:${line}`} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-body">{line.trim() === "" ? "blank" : line}</span>
                    {canMutate
                      ? (
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={lineLabel(line, index)}
                            onClick={() => dropLine(index)}
                            className={quietClass}
                          >
                            ×
                          </button>
                        )
                      : null}
                  </li>
                ))}
              </ul>
              {canMutate
                ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" disabled={busy || draft === saved} onClick={() => void save()} className={primaryClass}>
                        Save self notes
                      </button>
                      <button type="button" disabled={busy || draft === saved} onClick={revert} className={quietClass}>
                        Revert
                      </button>
                    </div>
                  )
                : null}
            </>
          )
        : null}
    </Fold>
  );
}
