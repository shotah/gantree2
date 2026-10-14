"use client";

import { useEffect, useId, useState, type SubmitEvent } from "react";
import { chipClass } from "@/app/components/shared/PageHeader";
import { agentsMessage, codeOf, patchConfig, startAuth, type ApiClient } from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import { grantsFromToml, tomlFromGrants } from "@/lib/agents/mcpToml";
import { keyHint, knownKey } from "@/lib/agents/keys";
import {
  googleOwnClientFlag,
  googlePlatformToolId,
  PLATFORM_GOOGLE_LINE,
  usesOwnGoogleClient,
} from "@/lib/agents/platform";
import type { AgentConfigView, AgentStatus, Grant, ToolEntry } from "@/lib/agents/types";
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
  house: readonly string[] = [],
): string[] {
  const have = new Set([...envKeys, ...house]);
  const notes: string[] = [];
  for (const grant of grants) {
    const tool = tools.find((item) => item.id === grant.name);
    const keys = tool?.needs ?? grant.env ?? [];
    for (const key of keys) {
      if (googlePlatformToolId(grant.name) && !usesOwnGoogleClient(grant.name, envKeys)) {
        continue;
      }
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
  for (const key of [...tool.needs, ...tool.optional]) {
    const value = drafts[draftId(tool.id, key)] ?? "";
    if (value.length > 0) {
      env[key] = value;
    }
  }
  return env;
}

function toolKeys(tool: ToolEntry): string[] {
  return [...tool.needs, ...tool.optional];
}

export const KEY_PLACEHOLDER_SET = "set — paste to replace";
export const KEY_PLACEHOLDER_MISSING = "paste the key";

/** Under Connect: the same login the chat slash command starts. */
export function connectChatHint(id: string): string {
  return `or type /auth ${id} in chat`;
}

/** Host on the authorize URL's `redirect_uri`. Empty when that param is missing or not a URL. */
export function stravaCallbackHost(authorizeUrl: string): string {
  try {
    const redirect = new URL(authorizeUrl).searchParams.get("redirect_uri") ?? "";
    if (redirect === "") {
      return "";
    }
    return new URL(redirect).hostname;
  } catch {
    return "";
  }
}

/**
 * Strava's API setting is Authorization Callback Domain, hostname only.
 * `usual` is the page host. `received` is the host Strava was sent, after Connect.
 */
export function stravaDomainHint(usual: string, received = ""): string {
  if (received !== "" && received !== usual) {
    return `Authorization Callback Domain is the hostname only. Strava received ${received}.`;
  }
  if (usual === "") {
    return "Authorization Callback Domain is the hostname only.";
  }
  return `Authorization Callback Domain is the hostname only (${usual}).`;
}

/**
 * Garmin's login is email, password, then `/auth garmin`. MFA is pasted as
 * `/auth garmin <code>` (see `mfaInstruction` in the garmin plugin).
 */
export const GARMIN_AUTH_HINT = "Set GARMIN_EMAIL and GARMIN_PASSWORD in Keys, then type /auth garmin in chat to sign in (MFA prompt follows)";

/** Published means connected. `no_oauth` means not connected. Anything else is not an oauth verdict. */
export function oauthLine(status: AgentStatus | null | undefined, id: string): "connected" | "not connected" | null {
  if (!status) {
    return null;
  }
  if (status.published.includes(id)) {
    return "connected";
  }
  const skip = status.skipped.find((item) => item.name === id);
  if (skip?.reason === "no_oauth") {
    return "not connected";
  }
  return null;
}

function KeyAbout({ name, line }: { name: string; line: string }) {
  const [open, setOpen] = useState(false);
  const hintId = useId();
  return (
    <>
      <button
        type="button"
        title={line}
        aria-label={`About ${name}`}
        aria-expanded={open}
        aria-controls={hintId}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-dim hover:text-fg focus:border-accent-line focus:outline-none"
      >
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
          <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 3.6a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3ZM9 9.1h2V15H9V9.1Z" />
        </svg>
      </button>
      {open ? <p id={hintId} className="basis-full text-xs text-dim">{line}</p> : null}
    </>
  );
}

function KeyFields({
  tool,
  envKeys,
  house,
  drafts,
  busy,
  canMutate,
  onDraft,
  onSave,
}: {
  tool: ToolEntry;
  envKeys: readonly string[];
  house: readonly string[];
  drafts: Readonly<Record<string, string>>;
  busy: boolean;
  canMutate: boolean;
  onDraft: (id: string, value: string) => void;
  onSave: (tool: ToolEntry) => void;
}) {
  const have = new Set([...envKeys, ...house]);
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
      {toolKeys(tool).map((key) => {
        const id = `tool-${tool.id}-${key}`;
        const set = have.has(key);
        const optional = tool.optional.includes(key);
        const meta = knownKey(key);
        const inputType = meta?.kind === "text" ? "text" : "password";
        const chip = optional
          ? (set ? "set" : "default")
          : (set ? "set" : "missing");
        const chipClassName = optional
          ? (set ? "border-ok/40 bg-ok/10 text-ok" : "border-line bg-canvas/60 text-dim")
          : (set ? "border-ok/40 bg-ok/10 text-ok" : "border-danger-line bg-danger-soft text-danger");
        return (
          <div key={key} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={id} className={labelClass}>
                <span className="font-mono text-body">{key}</span>
              </label>
              {meta ? <KeyAbout name={key} line={keyHint(meta)} /> : null}
              <span className={`${chipClass} ${chipClassName}`}>
                {chip}
              </span>
            </div>
            <input
              id={id}
              type={inputType}
              autoComplete="new-password"
              spellCheck={false}
              disabled={!canMutate || busy}
              placeholder={set ? KEY_PLACEHOLDER_SET : (optional ? "optional" : KEY_PLACEHOLDER_MISSING)}
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
  status = null,
  onPickKey,
}: {
  slug: string;
  config: AgentConfigView;
  tools: ToolEntry[];
  canMutate: boolean;
  client?: ApiClient;
  onConfig: (config: AgentConfigView) => void;
  status?: AgentStatus | null;
  /** Opens Keys with this name filled in. */
  onPickKey?: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [grants, setGrants] = useState<Grant[]>(() => grantsFromToml(config.mcp));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageHost, setPageHost] = useState("");
  const [stravaReceived, setStravaReceived] = useState("");

  useEffect(() => {
    setGrants(grantsFromToml(config.mcp));
  }, [config.mcp]);

  useEffect(() => {
    setPageHost(window.location.hostname);
  }, []);

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

  async function toggleOwnClient(tool: ToolEntry, own: boolean) {
    const flag = googleOwnClientFlag(tool.id);
    if (!flag) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onConfig(await patchConfig(slug, { env: { [flag]: own ? "1" : null } }, client));
    } catch (err) {
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

  async function connect(tool: ToolEntry) {
    setBusy(true);
    setError(null);
    try {
      const started = await startAuth(slug, tool.id, client);
      if (tool.id === "strava") {
        setStravaReceived(stravaCallbackHost(started.url));
      }
      window.open(started.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(codeOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Fold title="Tools" open={open} onOpen={setOpen} hint={`${grants.length} on`}>
      {error ? <p role="alert" className={`${alertClass} mb-3`}>{agentsMessage(error)}</p> : null}
      <ul className="space-y-2">
        {tools.map((tool) => {
          const on = grants.some((grant) => grant.name === tool.id);
          const line = tool.oauth ? oauthLine(status, tool.id) : null;
          const have = new Set([...config.envKeys, ...config.house]);
          const ownClient = usesOwnGoogleClient(tool.id, config.envKeys);
          const missing = on
            ? tool.needs.filter((key) => {
                if (googlePlatformToolId(tool.id) && !ownClient) {
                  return false;
                }
                return !have.has(key);
              })
            : [];
          const showKeyFields = on && toolKeys(tool).length > 0 && (!googlePlatformToolId(tool.id) || ownClient);
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
              {line ? <p className="text-xs text-dim">{line}</p> : null}
              {googlePlatformToolId(tool.id)
                ? (
                    <>
                      <label className="mt-2 flex items-center gap-2 text-xs text-fg">
                        <input
                          type="checkbox"
                          checked={ownClient}
                          disabled={!canMutate || busy}
                          onChange={() => void toggleOwnClient(tool, !ownClient)}
                        />
                        Use my own client
                      </label>
                      {!ownClient ? <p className="mt-1 text-xs text-dim">{PLATFORM_GOOGLE_LINE}</p> : null}
                    </>
                  )
                : null}
              {tool.id === "garmin"
                ? <p className="mt-1 text-xs text-dim">{GARMIN_AUTH_HINT}</p>
                : null}
              {tool.oauth && canMutate
                ? (
                    <>
                      <button type="button" disabled={busy} onClick={() => void connect(tool)} className={`${quietClass} mt-2`}>
                        Connect {tool.id}
                      </button>
                      <p className="mt-1 text-xs text-dim">{connectChatHint(tool.id)}</p>
                      {tool.id === "strava"
                        ? <p className="mt-1 text-xs text-dim">{stravaDomainHint(pageHost, stravaReceived)}</p>
                        : null}
                    </>
                  )
                : null}
              {missing.map((key) => (
                <p key={key} className="mt-1">
                  <button
                    type="button"
                    className="text-left text-xs text-danger underline decoration-danger/40 underline-offset-2"
                    onClick={() => onPickKey?.(key)}
                  >
                    {`${tool.id} needs ${key}`}
                  </button>
                </p>
              ))}
              {showKeyFields
                ? (
                    <KeyFields
                      tool={tool}
                      envKeys={config.envKeys}
                      house={config.house}
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
