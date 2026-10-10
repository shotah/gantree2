"use client";

import { useEffect, useState, type SubmitEvent } from "react";
import {
  agentsMessage,
  codeOf,
  patchConfig,
  recreateForKeys,
  type ApiClient,
} from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import type { AgentConfigView } from "@/lib/agents/types";
import { alertClass, Fold, inputClass, labelClass, primaryClass, quietClass } from "./Fold";

export function cleanSecretKey(raw: string): string | null {
  const key = raw.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }
  return key;
}

export function SecretsFold({
  slug,
  config,
  canMutate,
  client = api,
  onConfig,
}: {
  slug: string;
  config: AgentConfigView;
  canMutate: boolean;
  client?: ApiClient;
  onConfig: (config: AgentConfigView) => void;
}) {
  const [open, setOpen] = useState(config.recreate);
  const [keyName, setKeyName] = useState("");

  useEffect(() => {
    if (config.recreate) {
      setOpen(true);
    }
  }, [config.recreate]);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function write(env: Record<string, string | null>, clearForm: boolean) {
    setBusy(true);
    setError(null);
    try {
      onConfig(await patchConfig(slug, { env }, client));
      if (clearForm) {
        setKeyName("");
        setValue("");
      }
    } catch (err) {
      setError(codeOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function recreate() {
    setBusy(true);
    setError(null);
    try {
      onConfig(await recreateForKeys(slug, client));
    } catch (err) {
      setError(codeOf(err));
    } finally {
      setBusy(false);
    }
  }

  function add(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const key = cleanSecretKey(keyName);
    if (!key) {
      setError("Use a key name like MAPS_KEY.");
      return;
    }
    if (value.length === 0) {
      setError("Add a value for that key.");
      return;
    }
    void write({ [key]: value }, true);
  }

  const typed = cleanSecretKey(keyName);
  const replacing = typed !== null && config.envKeys.includes(typed);

  return (
    <Fold title="Keys" open={open} onOpen={setOpen} hint={`${config.envKeys.length} keys`}>
      <p className="mb-3 text-xs text-dim">
        Values stay on the agent. This list is keys only. Saving a name that is already here replaces its value; a tool&apos;s own keys can also be pasted under Tools.
      </p>
      {config.recreate
        ? (
            <div role="status" className={`${alertClass} mb-3`}>
              <p>Keys changed. Recreate the container so they take effect.</p>
              {canMutate
                ? (
                    <button type="button" disabled={busy} onClick={() => void recreate()} className={`${quietClass} mt-2`}>
                      Recreate to apply keys
                    </button>
                  )
                : null}
            </div>
          )
        : null}
      {error ? <p role="alert" className={`${alertClass} mb-3`}>{agentsMessage(error)}</p> : null}
      {config.house.length > 0
        ? (
            <p role="note" className="mb-3 text-xs text-dim">
              From the server: <span className="font-mono text-fg">{config.house.join(", ")}</span>. A key set here replaces the house value.
            </p>
          )
        : null}
      {config.envKeys.length === 0
        ? <p className="text-sm text-muted">No keys yet.</p>
        : (
            <ul aria-label="Keys" className="space-y-2">
              {config.envKeys.map((key) => (
                <li key={key} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-mono text-fg">{key}</span>
                  {canMutate
                    ? (
                        <button type="button" disabled={busy} onClick={() => void write({ [key]: null }, false)} className={quietClass}>
                          Remove {key}
                        </button>
                      )
                    : null}
                </li>
              ))}
            </ul>
          )}
      {canMutate
        ? (
            <form aria-label="Add or replace a key" className="mt-4 flex flex-wrap items-end gap-2" onSubmit={add}>
              <div className="flex flex-col gap-1">
                <label htmlFor="secret-key" className={labelClass}>Key</label>
                <input id="secret-key" value={keyName} autoComplete="off" spellCheck={false} onChange={(e) => setKeyName(e.target.value)} className={inputClass} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="secret-value" className={labelClass}>Value</label>
                <input id="secret-value" type="password" value={value} autoComplete="new-password" spellCheck={false} onChange={(e) => setValue(e.target.value)} className={inputClass} />
              </div>
              <button type="submit" disabled={busy} className={primaryClass}>{replacing ? "Replace key" : "Add key"}</button>
            </form>
          )
        : null}
    </Fold>
  );
}
