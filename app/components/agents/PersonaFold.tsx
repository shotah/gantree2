"use client";

import { useEffect, useState } from "react";
import { agentsMessage, codeOf, patchConfig, type ApiClient } from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import { alertClass, Fold, primaryClass } from "./Fold";

export function PersonaFold({
  slug,
  persona,
  canMutate,
  client = api,
  onPersona,
}: {
  slug: string;
  persona: string;
  canMutate: boolean;
  client?: ApiClient;
  onPersona: (persona: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(persona);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(persona);
  }, [persona]);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const view = await patchConfig(slug, { persona: draft }, client);
      onPersona(view.persona);
      setNotice("Saved.");
    } catch (err) {
      setError(codeOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Fold title="Persona" open={open} onOpen={setOpen}>
      {error ? <p role="alert" className={`${alertClass} mb-3`}>{agentsMessage(error)}</p> : null}
      {notice ? <p role="status" className="mb-3 text-sm text-body">{notice}</p> : null}
      <label htmlFor="persona-draft" className="mb-1 block text-xs text-muted">Persona text</label>
      <textarea
        id="persona-draft"
        value={draft}
        rows={12}
        disabled={!canMutate || busy}
        onChange={(e) => {
          setDraft(e.target.value);
          setNotice(null);
        }}
        className="w-full rounded border border-line bg-canvas px-3 py-2 font-mono text-xs text-body"
      />
      {canMutate
        ? (
            <button type="button" disabled={busy} onClick={() => void save()} className={`${primaryClass} mt-3`}>
              Save persona
            </button>
          )
        : null}
    </Fold>
  );
}
