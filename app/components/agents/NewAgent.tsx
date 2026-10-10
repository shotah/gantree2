"use client";

import { useEffect, useState, type SubmitEvent } from "react";
import { ThemeSelect } from "@/app/components/shared/ThemeSelect";
import {
  agentsMessage,
  codeOf,
  createAgent,
  listTools,
  patchConfig,
  type ApiClient,
} from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import { tomlFromGrants } from "@/lib/agents/mcpToml";
import { AGENT_SLUG, type AgentCreate, type Grant, type ToolEntry } from "@/lib/agents/types";
import { assignHref } from "./follow";
import { alertClass, inputClass, labelClass, mainClass, primaryClass, quietClass } from "./Fold";
import { PERSONA_TEMPLATE } from "./personaTemplate";

export function parseTagList(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const tag = part.trim();
    if (tag && !out.includes(tag)) {
      out.push(tag);
    }
  }
  return out;
}

function needId(tool: string, key: string): string {
  return `${tool}:${key}`;
}

export function NewAgent({
  home = false,
  client = api,
  go = assignHref,
}: {
  home?: boolean;
  client?: ApiClient;
  go?: (href: string) => void;
}) {
  const [step, setStep] = useState(1);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [persona, setPersona] = useState(PERSONA_TEMPLATE);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [extras, setExtras] = useState<{ id: number; key: string; value: string }[]>([]);
  const [nextExtra, setNextExtra] = useState(1);
  const [tools, setTools] = useState<ToolEntry[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [needs, setNeeds] = useState<Record<string, string>>({});
  const [made, setMade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    void listTools(client).then((rows) => {
      if (!dead) {
        setTools(rows);
        setToolsError(null);
      }
    }).catch((err: unknown) => {
      if (!dead) {
        setToolsError(codeOf(err));
      }
    });
    return () => {
      dead = true;
    };
  }, [client]);

  const slugOk = AGENT_SLUG.test(slug);
  const nameOk = name.trim().length > 0;
  const keysOk = baseUrl.trim().length > 0 && apiKey.trim().length > 0 && model.trim().length > 0;
  const visible = (tools ?? []).filter((tool) => home || !tool.homeOnly);
  const nextDisabled = busy || (step === 1 && (!slugOk || !nameOk)) || (step === 3 && !keysOk);

  function forward() {
    setError(null);
    setStep((current) => current === 1 ? 2 : current === 2 ? 3 : 4);
  }

  function back() {
    setError(null);
    setStep((current) => current === 4 ? 3 : current === 3 ? 2 : 1);
  }

  function collectEnv(): Record<string, string> | null {
    const env: Record<string, string> = {
      LLM_BASE_URL: baseUrl.trim(),
      LLM_API_KEY: apiKey.trim(),
      LLM_MODEL: model.trim(),
    };
    for (const row of extras) {
      const key = row.key.trim();
      if (key) {
        env[key] = row.value;
      }
    }
    const missing: string[] = [];
    for (const tool of visible) {
      if (!picked[tool.id]) {
        continue;
      }
      for (const key of tool.needs) {
        const value = (needs[needId(tool.id, key)] ?? "").trim();
        if (!value) {
          missing.push(`${tool.id} ${key}`);
        } else {
          env[key] = value;
        }
      }
    }
    if (missing.length > 0) {
      setError(`Add a value for ${missing.join(", ")}.`);
      return null;
    }
    return env;
  }

  async function create() {
    const env = collectEnv();
    if (!env) {
      return;
    }
    const selected = visible.filter((tool) => picked[tool.id]);
    const grants: Grant[] = selected.map((tool) => ({
      name: tool.id,
      command: tool.binary,
      env: tool.needs,
    }));
    const body: AgentCreate = { slug, name: name.trim() };
    const tagList = parseTagList(tags);
    if (tagList.length > 0) {
      body.tags = tagList;
    }
    setBusy(true);
    setError(null);
    try {
      let target = made;
      if (!target) {
        const created = await createAgent(body, client);
        target = created.slug;
        setMade(target);
      }
      await patchConfig(target, { env, persona, mcp: tomlFromGrants(grants) }, client);
      go(`/agents/${target}`);
    } catch (err) {
      setError(codeOf(err));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step < 4) {
      forward();
      return;
    }
    void create();
  }

  const titles = ["Name", "Persona", "Keys", "Tools"];

  return (
    <main className={mainClass}>
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <a href="/agents" className="text-sm text-muted hover:text-body">Agents</a>
          <h1 className="text-2xl font-semibold text-fg">New agent</h1>
          <p className="text-sm text-muted">Step {step} of 4 — {titles[step - 1]}</p>
        </div>
        <div className="w-40 shrink-0">
          <ThemeSelect />
        </div>
      </header>

      {error ? <p role="alert" className={alertClass}>{agentsMessage(error)}</p> : null}
      {toolsError && step === 4 ? <p role="alert" className={alertClass}>{agentsMessage(toolsError)}</p> : null}

      <form aria-label="New agent" className="flex flex-col gap-4" onSubmit={onSubmit}>
        {step === 1
          ? (
              <>
                <div className="flex flex-col gap-1">
                  <label htmlFor="agent-slug" className={labelClass}>Slug</label>
                  <input
                    id="agent-slug"
                    value={slug}
                    disabled={made !== null}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="kit"
                    onChange={(e) => setSlug(e.target.value)}
                    className={inputClass}
                  />
                  {slug.length > 0 && !slugOk
                    ? <p className="text-xs text-danger">Use a letter, then lowercase letters, digits, or hyphens.</p>
                    : null}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="agent-name" className={labelClass}>Display name</label>
                  <input
                    id="agent-name"
                    value={name}
                    disabled={made !== null}
                    autoComplete="off"
                    placeholder="Kit"
                    onChange={(e) => setName(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="agent-tags" className={labelClass}>Tags</label>
                  <input
                    id="agent-tags"
                    value={tags}
                    disabled={made !== null}
                    autoComplete="off"
                    placeholder="home, travel"
                    onChange={(e) => setTags(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </>
            )
          : null}

        {step === 2
          ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="agent-persona" className={labelClass}>Persona</label>
                <textarea
                  id="agent-persona"
                  value={persona}
                  rows={16}
                  onChange={(e) => setPersona(e.target.value)}
                  className={`${inputClass} min-h-64 font-mono text-xs`}
                />
              </div>
            )
          : null}

        {step === 3
          ? (
              <>
                <p className="text-xs text-dim">Write-only. The agent stores them; this form will not show them again.</p>
                <div className="flex flex-col gap-1">
                  <label htmlFor="llm-base" className={labelClass}>LLM_BASE_URL</label>
                  <input id="llm-base" value={baseUrl} autoComplete="off" spellCheck={false} onChange={(e) => setBaseUrl(e.target.value)} className={inputClass} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="llm-key" className={labelClass}>LLM_API_KEY</label>
                  <input id="llm-key" type="password" value={apiKey} autoComplete="new-password" spellCheck={false} onChange={(e) => setApiKey(e.target.value)} className={inputClass} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="llm-model" className={labelClass}>LLM_MODEL</label>
                  <input id="llm-model" value={model} autoComplete="off" spellCheck={false} onChange={(e) => setModel(e.target.value)} className={inputClass} />
                </div>
                {extras.map((row) => (
                  <div key={row.id} className="flex flex-wrap items-end gap-2">
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`extra-key-${row.id}`} className={labelClass}>Key</label>
                      <input
                        id={`extra-key-${row.id}`}
                        value={row.key}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(e) => setExtras((rows) => rows.map((item) => item.id === row.id ? { ...item, key: e.target.value } : item))}
                        className={inputClass}
                      />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <label htmlFor={`extra-value-${row.id}`} className={labelClass}>Value</label>
                      <input
                        id={`extra-value-${row.id}`}
                        type="password"
                        value={row.value}
                        autoComplete="new-password"
                        spellCheck={false}
                        onChange={(e) => setExtras((rows) => rows.map((item) => item.id === row.id ? { ...item, value: e.target.value } : item))}
                        className={inputClass}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setExtras((rows) => rows.filter((item) => item.id !== row.id))}
                      className={quietClass}
                    >
                      Remove extra {row.id}
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setExtras((rows) => [...rows, { id: nextExtra, key: "", value: "" }]);
                    setNextExtra((n) => n + 1);
                  }}
                  className={quietClass}
                >
                  Add a key
                </button>
              </>
            )
          : null}

        {step === 4
          ? (
              <div className="flex flex-col gap-3">
                {tools === null && !toolsError ? <p className="text-sm text-muted">Loading tools.</p> : null}
                {tools !== null && visible.length === 0 ? <p className="text-sm text-muted">No tools to show.</p> : null}
                {visible.map((tool) => {
                  const on = Boolean(picked[tool.id]);
                  return (
                    <div key={tool.id} className="rounded border border-line px-3 py-3">
                      <label className="flex items-center gap-2 text-sm text-fg">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => setPicked((prev) => ({ ...prev, [tool.id]: e.target.checked }))}
                        />
                        {tool.id}
                      </label>
                      <p className="mt-1 text-xs text-dim">{tool.binary}</p>
                      {tool.homeOnly ? <p className="mt-1 text-xs text-dim">Home</p> : null}
                      {tool.oauth ? <p className="mt-1 text-xs text-dim">Sign in from chat before this publishes.</p> : null}
                      {on
                        ? tool.needs.map((key) => (
                            <div key={key} className="mt-2 flex flex-col gap-1">
                              <label htmlFor={`need-${tool.id}-${key}`} className={labelClass}>{key}</label>
                              <input
                                id={`need-${tool.id}-${key}`}
                                type="password"
                                autoComplete="new-password"
                                spellCheck={false}
                                value={needs[needId(tool.id, key)] ?? ""}
                                onChange={(e) => setNeeds((prev) => ({ ...prev, [needId(tool.id, key)]: e.target.value }))}
                                className={inputClass}
                              />
                            </div>
                          ))
                        : null}
                    </div>
                  );
                })}
              </div>
            )
          : null}

        <div className="flex flex-wrap gap-2">
          {step > 1
            ? (
                <button type="button" onClick={back} className={quietClass}>Back</button>
              )
            : null}
          {step < 4
            ? (
                <button type="submit" disabled={nextDisabled} className={primaryClass}>Next</button>
              )
            : (
                <button type="submit" disabled={busy || tools === null || toolsError !== null} className={primaryClass}>
                  Create agent
                </button>
              )}
        </div>
      </form>
    </main>
  );
}
