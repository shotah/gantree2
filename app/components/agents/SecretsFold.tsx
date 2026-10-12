"use client";

import { useEffect, useId, useRef, useState, type FocusEvent, type ReactNode, type SubmitEvent } from "react";
import {
  agentsMessage,
  codeOf,
  patchConfig,
  type ApiClient,
} from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import { groupKeys, keyHint, knownKey, pickerKeys, type KnownKey } from "@/lib/agents/keys";
import type { AgentConfigView } from "@/lib/agents/types";
import { alertClass, Fold, inputClass, labelClass, primaryClass, quietClass } from "./Fold";

export function cleanSecretKey(raw: string): string | null {
  const key = raw.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }
  return key;
}

function KeyLine({
  name,
  meta,
  muted,
  trailing,
}: {
  name: string;
  meta: KnownKey | undefined;
  muted?: boolean;
  trailing?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hintId = useId();
  const line = meta ? keyHint(meta) : "";
  return (
    <li role={muted ? "note" : undefined} className={`text-sm ${muted ? "text-dim" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`font-mono ${muted ? "" : "text-fg"}`}>{name}</span>
        <span className="flex items-center gap-2">
          {meta
            ? (
                <button
                  type="button"
                  title={line}
                  aria-label={`About ${name}`}
                  aria-expanded={open}
                  aria-controls={hintId}
                  onFocus={() => setOpen(true)}
                  onBlur={() => setOpen(false)}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-dim hover:text-fg focus:border-accent-line focus:outline-none"
                >
                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
                    <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 3.6a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3ZM9 9.1h2V15H9V9.1Z" />
                  </svg>
                </button>
              )
            : null}
          {trailing}
        </span>
      </div>
      {open && meta ? <p id={hintId} className="mt-1 text-xs text-dim">{line}</p> : null}
    </li>
  );
}

export function SecretsFold({
  slug,
  config,
  canMutate,
  client = api,
  onConfig,
  pick = null,
}: {
  slug: string;
  config: AgentConfigView;
  canMutate: boolean;
  client?: ApiClient;
  onConfig: (config: AgentConfigView) => void;
  /** Opens the fold and fills the key field. `n` changes when the same name is picked again. */
  pick?: { name: string; n: number } | null;
}) {
  const [open, setOpen] = useState(config.recreate);
  const [keyName, setKeyName] = useState("");
  const [addHint, setAddHint] = useState(false);
  const addHintId = useId();
  const focusedPick = useRef(0);

  useEffect(() => {
    if (config.recreate) {
      setOpen(true);
    }
  }, [config.recreate]);

  useEffect(() => {
    if (!pick?.name) {
      return;
    }
    setOpen(true);
    setKeyName(pick.name);
  }, [pick]);

  useEffect(() => {
    if (!pick?.name || !open || focusedPick.current === pick.n) {
      return;
    }
    const field = document.getElementById("secret-key");
    if (!field) {
      return;
    }
    focusedPick.current = pick.n;
    field.focus();
  }, [pick, open]);

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

  function formBlur(e: FocusEvent<HTMLFormElement>) {
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) {
      return;
    }
    setAddHint(false);
  }

  const typed = cleanSecretKey(keyName);
  const replacing = typed !== null && config.envKeys.includes(typed);
  const offered = pickerKeys(config.envKeys, config.house);
  const groups = groupKeys(offered);
  const picked = knownKey(keyName.trim());
  const showAddHint = addHint && picked !== undefined;
  const houseOnly = config.house.filter((key) => !config.envKeys.includes(key));
  const none = config.envKeys.length === 0 && houseOnly.length === 0;

  return (
    <Fold title="Keys" open={open} onOpen={setOpen} hint={`${config.envKeys.length} keys`}>
      <p className="mb-3 text-xs text-dim">
        Values stay on the agent. This list is keys only. Saving a name that is already here replaces its value; a tool&apos;s own keys can also be pasted under Tools.
      </p>
      {error ? <p role="alert" className={`${alertClass} mb-3`}>{agentsMessage(error)}</p> : null}
      {none
        ? <p className="text-sm text-muted">No keys yet.</p>
        : (
            <ul aria-label="Keys" className="space-y-2">
              {config.envKeys.map((key) => (
                <KeyLine
                  key={key}
                  name={key}
                  meta={knownKey(key)}
                  trailing={canMutate
                    ? (
                        <button type="button" disabled={busy} onClick={() => void write({ [key]: null }, false)} className={quietClass}>
                          Remove {key}
                        </button>
                      )
                    : null}
                />
              ))}
              {houseOnly.map((key) => (
                <KeyLine
                  key={`house-${key}`}
                  name={key}
                  meta={knownKey(key)}
                  muted
                  trailing={<span className="text-xs">from house</span>}
                />
              ))}
            </ul>
          )}
      {canMutate
        ? (
            <form
              aria-label="Add or replace a key"
              className="mt-4 flex flex-wrap items-end gap-2"
              onSubmit={add}
              onFocus={() => setAddHint(true)}
              onBlur={formBlur}
            >
              <div className="flex min-w-48 flex-col gap-1">
                <label htmlFor="known-key-select" className={labelClass}>Known keys</label>
                <select
                  id="known-key-select"
                  value={offered.some((key) => key.name === keyName.trim()) ? keyName.trim() : ""}
                  onChange={(e) => {
                    if (e.target.value) {
                      setKeyName(e.target.value);
                    }
                  }}
                  className={inputClass}
                >
                  <option value="">Choose a known key</option>
                  {groups.map((group) => (
                    <optgroup key={group.plugin} label={group.plugin}>
                      {group.keys.map((key) => (
                        <option key={key.name} value={key.name}>{key.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="secret-key" className={labelClass}>Key</label>
                <input
                  id="secret-key"
                  list="known-keys"
                  value={keyName}
                  autoComplete="off"
                  spellCheck={false}
                  title={picked ? keyHint(picked) : undefined}
                  aria-describedby={showAddHint ? addHintId : undefined}
                  onChange={(e) => setKeyName(e.target.value)}
                  className={inputClass}
                />
                <datalist id="known-keys">
                  {offered.map((key) => (
                    <option key={key.name} value={key.name}>{`${key.plugin} — ${key.label}`}</option>
                  ))}
                </datalist>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="secret-value" className={labelClass}>Value</label>
                <input
                  id="secret-value"
                  type={picked?.kind === "text" ? "text" : "password"}
                  value={value}
                  autoComplete={picked?.kind === "text" ? "off" : "new-password"}
                  spellCheck={false}
                  onChange={(e) => setValue(e.target.value)}
                  className={inputClass}
                />
              </div>
              <button type="submit" disabled={busy} className={primaryClass}>{replacing ? "Replace key" : "Add key"}</button>
              {showAddHint && picked
                ? <p id={addHintId} className="basis-full text-xs text-dim">{keyHint(picked)}</p>
                : null}
            </form>
          )
        : null}
    </Fold>
  );
}
