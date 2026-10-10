"use client";

import { useEffect, useState, type SubmitEvent } from "react";
import { chipClass } from "@/app/components/shared/PageHeader";
import { agentsMessage, codeOf, patchConfig, recreateForKeys, type ApiClient } from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import { grantsFromToml, tomlFromGrants } from "@/lib/agents/mcpToml";
import type { AgentConfigView, Grant, ToolEntry } from "@/lib/agents/types";
import { alertClass, Fold, inputClass, labelClass, primaryClass, quietClass } from "./Fold";

export function grantFor(tool: ToolEntry): Grant {
  return { name: tool.id, command: tool.binary, env: tool.needs };
}

export function withGrant(grants: readonly Grant[], tool: ToolEntry, on: boolean): Grant[] {
  const rest = grants.filter((grant) => grant.name !== tool.id);
  return on ? [...rest, grantFor(tool)] : rest;
}

export function missingNeeds(
  grants: readonly Grant[],
  tools: readonly ToolEntry[],
  envKeys: readonly string[],
): string[] {
  const have = new Set(envKeys);
  const notes: string[] = [];
  for (const grant of grants) {
    const tool = tools.find((item) => item.id === grant.name);
    const keys = tool?.needs ?? grant.env ?? [];
    for (const key of keys) {
      if (!have.has(key)) {
        notes.push(`${grant.name} needs ${key}`);
      }
    }
  }
  return notes;
}

/** One draft slot per (tool, key); a key shared by two tools is still one env key. */
export function draftId(toolId: string, key: string): string {
  return `${toolId}\0${key}`;
}

/** The env patch a tool's form sends: only the keys that were typed into. */
export function envPatchFor(tool: ToolEntry, drafts: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of tool.needs) {
    const value = drafts[draftId(tool.id, key)] ?? "";
    if (value.length > 0) {
      env[key] = value;
    }
  }
  return env;
}

export const KEY_PLACEHOLDER_SET = "set — paste to replace";
export const KEY_PLACEHOLDER_MISSING = "paste the key";

function KeyFields({
  tool,
  envKeys,
  drafts,
  busy,
  canMutate,
  onDraft,
  onSave,
}: {
  tool: ToolEntry;
  envKeys: readonly string[];
  drafts: Readonly<Record<string, string>>;
  busy: boolean;
  canMutate: boolean;
  onDraft: (id: string, value: string) => void;
  onSave: (tool: ToolEntry) => void;
}) {
  const have = new Set(envKeys);
  const patch = envPatchFor(tool, drafts);
  const dirty = Object.keys(patch).length > 0;
  return (
    <form
      aria-label={`Keys for ${tool.id}`}
      className="mt-3 flex flex-col gap-2 border-t border-line pt-3"
      onSubmit={(e: SubmitEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (dirty) {
          onSave(tool);
        }
      }}
    >
      {tool.needs.map((key) => {
        const id = `tool-${tool.id}-${key}`;
        const set = have.has(key);
        return (
          <div key={key} className="flex flex-col gap-1">
            <label htmlFor={id} className={`${labelClass} flex items-center gap-2`}>
              <span className="font-mono text-body">{key}</span>
              <span className={`${chipClass} ${set ? "border-ok/40 bg-ok/10 text-ok" : "border-danger-line bg-danger-soft text-danger"}`}>
                {set ? "set" : "missing"}
              </span>
            </label>
            <input
              id={id}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              disabled={!canMutate || busy}
              placeholder={set ? KEY_PLACEHOLDER_SET : KEY_PLACEHOLDER_MISSING}
              value={drafts[draftId(tool.id, key)] ?? ""}
              onChange={(e) => onDraft(draftId(tool.id, key), e.target.value)}
              className={`${inputClass} w-full`}
            />
          </div>
        );
      })}
      {canMutate
        ? (
            <div>
              <button type="submit" disabled={busy || !dirty} className={primaryClass}>
                Save keys for {tool.id}
              </button>
            </div>
          )
        : null}
    </form>
  );
}

export function ToolsFold({
  slug,
  config,
  tools,
  canMutate,
  client = api,
  onConfig,
}: {
  slug: string;
  config: AgentConfigView;
  tools: ToolEntry[];
  canMutate: boolean;
  client?: ApiClient;
  onConfig: (config: AgentConfigView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [grants, setGrants] = useState<Grant[]>(() => grantsFromToml(config.mcp));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setGrants(grantsFromToml(config.mcp));
  }, [config.mcp]);

  async function toggle(tool: ToolEntry, on: boolean) {
    const next = withGrant(grants, tool, on);
    setGrants(next);
    setBusy(true);
    setError(null);
    try {
      onConfig(await patchConfig(slug, { mcp: tomlFromGrants(next, config.mcp) }, client));
    } catch (err) {
      setGrants(grantsFromToml(config.mcp));
      setError(codeOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveKeys(tool: ToolEntry) {
    const env = envPatchFor(tool, drafts);
    setBusy(true);
    setError(null);
    try {
      onConfig(await patchConfig(slug, { env }, client));
      setDrafts((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(env)) {
          delete next[draftId(tool.id, key)];
        }
        return next;
      });
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

  const notes = missingNeeds(grants, tools, config.envKeys);

  return (
    <Fold title="Tools" open={open} onOpen={setOpen} hint={`${grants.length} on`}>
      {error ? <p role="alert" className={`${alertClass} mb-3`}>{agentsMessage(error)}</p> : null}
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
      {notes.length > 0
        ? (
            <ul aria-label="Missing keys" className="mb-3 space-y-1">
              {notes.map((note) => <li key={note} className="text-xs text-danger">{note}</li>)}
            </ul>
          )
        : null}
      <ul className="space-y-2">
        {tools.map((tool) => {
          const on = grants.some((grant) => grant.name === tool.id);
          return (
            <li key={tool.id} className="rounded-xl border border-line bg-canvas/40 px-3 py-2">
              <label className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!canMutate || busy}
                  onChange={() => void toggle(tool, !on)}
                />
                {tool.id}
              </label>
              <p className="mt-1 text-xs text-dim">{tool.binary}</p>
              {tool.homeOnly ? <p className="text-xs text-dim">Home</p> : null}
              {tool.oauth ? <p className="text-xs text-dim">Sign in from chat before this publishes.</p> : null}
              {on && tool.needs.length > 0
                ? (
                    <KeyFields
                      tool={tool}
                      envKeys={config.envKeys}
                      drafts={drafts}
                      busy={busy}
                      canMutate={canMutate}
                      onDraft={(id, value) => setDrafts((prev) => ({ ...prev, [id]: value }))}
                      onSave={(item) => void saveKeys(item)}
                    />
                  )
                : null}
            </li>
          );
        })}
      </ul>
    </Fold>
  );
}
