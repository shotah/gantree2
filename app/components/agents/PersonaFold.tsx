"use client";

import { useEffect, useState } from "react";
import { agentsMessage, codeOf, getPersona, patchConfig, putPersona, type ApiClient } from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import type { AgentRuntime } from "@/lib/agents/types";
import { alertClass, Fold, primaryClass } from "./Fold";

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function PersonaFold({
  slug,
  persona,
  runtime = "container",
  canMutate,
  client = api,
  onPersona,
}: {
  slug: string;
  persona: string;
  runtime?: AgentRuntime;
  canMutate: boolean;
  client?: ApiClient;
  onPersona: (persona: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(persona);
  const [maxChars, setMaxChars] = useState(0);
  const [loaded, setLoaded] = useState(runtime !== "native");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const native = runtime === "native";

  useEffect(() => {
    if (native) {
      return;
    }
    setDraft(persona);
    setLoaded(true);
  }, [persona, native]);

  useEffect(() => {
    if (!native) {
      return;
    }
    setLoaded(false);
  }, [native]);

  useEffect(() => {
    if (!open || !native) {
      return;
    }
    let gone = false;
    setError(null);
    void getPersona(slug, client).then((page) => {
      if (gone) {
        return;
      }
      const file = page.files.find((item) => item.name === "PERSONA.md");
      setDraft(file?.text ?? "");
      setMaxChars(page.maxChars);
      setLoaded(true);
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
      if (native) {
        const page = await putPersona(slug, draft, client);
        const file = page.files.find((item) => item.name === "PERSONA.md");
        const text = file?.text ?? draft;
        setDraft(text);
        setMaxChars(page.maxChars);
        onPersona(text);
      } else {
        const view = await patchConfig(slug, { persona: draft }, client);
        onPersona(view.persona);
      }
      setNotice("Saved.");
    } catch (err) {
      setError(codeOf(err));
    } finally {
      setBusy(false);
    }
  }

  const chars = utf8Length(draft);

  return (
    <Fold title="Persona" open={open} onOpen={setOpen}>
      {error ? <p role="alert" className={`${alertClass} mb-3`}>{agentsMessage(error)}</p> : null}
      {notice ? <p role="status" className="mb-3 text-sm text-body">{notice}</p> : null}
      {native && !loaded && !error ? <p className="text-sm text-muted">Loading persona.</p> : null}
      {!native || loaded
        ? (
            <>
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
              {native
                ? (
                    <p aria-label="Persona length" className={`mt-2 text-xs ${maxChars > 0 && chars > maxChars ? "text-danger" : "text-dim"}`}>
                      {`${String(chars)} / ${String(maxChars)}`}
                    </p>
                  )
                : null}
              {canMutate
                ? (
                    <button type="button" disabled={busy} onClick={() => void save()} className={`${primaryClass} mt-3`}>
                      Save persona
                    </button>
                  )
                : null}
            </>
          )
        : null}
    </Fold>
  );
}
