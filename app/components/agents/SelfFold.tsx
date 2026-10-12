"use client";

import { useEffect, useState } from "react";
import { agentsMessage, codeOf, getSelf, putSelf, type ApiClient } from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import { notesOnly } from "@/harness/selfnote/stamp";
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
  canMutate,
  client = api,
}: {
  slug: string;
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
  useEffect(() => {
    if (!open) {
      return;
    }
    let gone = false;
    setError(null);
    void getSelf(slug, client).then((page) => {
      if (gone) {
        return;
      }
      const notes = notesOnly(page.text);
      setSaved(notes);
      setDraft(notes);
      setMaxChars(page.maxChars);
    }).catch((err: unknown) => {
      if (!gone) {
        setError(codeOf(err));
      }
    });
    return () => {
      gone = true;
    };
  }, [open, slug, client]);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const page = await putSelf(slug, notesOnly(draft), client);
      const notes = notesOnly(page.text);
      setSaved(notes);
      setDraft(notes);
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
    const lines = notesOnly(draft).split("\n");
    lines.splice(index, 1);
    setDraft(lines.join("\n"));
    setNotice(null);
  }

  const visible = notesOnly(draft);
  const chars = utf8Length(visible);
  const over = maxChars > 0 && chars > maxChars;
  const lines = visible.split("\n");
  const dirty = visible !== saved;

  return (
    <Fold title="Self notes" open={open} onOpen={setOpen}>
      {error ? <p role="alert" className={`${alertClass} mb-3`}>{agentsMessage(error)}</p> : null}
      {notice ? <p role="status" className="mb-3 text-sm text-body">{notice}</p> : null}
      {saved === null && !error ? <p className="text-sm text-muted">Loading self notes.</p> : null}
      {saved !== null
        ? (
            <>
              <label htmlFor="self-draft" className="mb-1 block text-xs text-muted">Self notes text</label>
              <textarea
                id="self-draft"
                value={visible}
                rows={12}
                disabled={!canMutate || busy}
                onChange={(e) => {
                  setDraft(notesOnly(e.target.value));
                  setNotice(null);
                }}
                className="w-full rounded border border-line bg-canvas px-3 py-2 font-mono text-xs text-body"
              />
              <p aria-label="Self notes length" className={`mt-2 text-xs ${over ? "text-danger" : "text-dim"}`}>
                {`${String(chars)} / ${String(maxChars)}`}
              </p>
              <p className="mt-1 text-xs text-dim">
                Notes the agent keeps about how it shows up. You can remove a line. The agent&apos;s own instructions stay off this list.
              </p>
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
                      <button type="button" disabled={busy || !dirty} onClick={() => void save()} className={primaryClass}>
                        Save self notes
                      </button>
                      <button type="button" disabled={busy || !dirty} onClick={revert} className={quietClass}>
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
