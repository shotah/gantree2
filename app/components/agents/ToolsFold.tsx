"use client";

import { useEffect, useState } from "react";
import { agentsMessage, codeOf, patchConfig, type ApiClient } from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import { grantsFromToml, tomlFromGrants } from "@/lib/agents/mcpToml";
import type { Grant, ToolEntry } from "@/lib/agents/types";
import { alertClass, Fold } from "./Fold";

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

export function ToolsFold({
  slug,
  mcp,
  envKeys,
  tools,
  canMutate,
  client = api,
  onMcp,
}: {
  slug: string;
  mcp: string;
  envKeys: string[];
  tools: ToolEntry[];
  canMutate: boolean;
  client?: ApiClient;
  onMcp: (mcp: string, envKeys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [grants, setGrants] = useState<Grant[]>(() => grantsFromToml(mcp));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setGrants(grantsFromToml(mcp));
  }, [mcp]);

  async function toggle(tool: ToolEntry, on: boolean) {
    const next = withGrant(grants, tool, on);
    setGrants(next);
    setBusy(true);
    setError(null);
    try {
      const view = await patchConfig(slug, { mcp: tomlFromGrants(next, mcp) }, client);
      onMcp(view.mcp, view.envKeys);
    } catch (err) {
      setGrants(grantsFromToml(mcp));
      setError(codeOf(err));
    } finally {
      setBusy(false);
    }
  }

  const notes = missingNeeds(grants, tools, envKeys);

  return (
    <Fold title="Tools" open={open} onOpen={setOpen} hint={`${grants.length} on`}>
      {error ? <p role="alert" className={`${alertClass} mb-3`}>{agentsMessage(error)}</p> : null}
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
            <li key={tool.id} className="rounded border border-line px-3 py-2">
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
            </li>
          );
        })}
      </ul>
    </Fold>
  );
}
