"use client";

import { useEffect, useState, type SubmitEvent } from "react";
import { PageHeader, cardClass, chipClass } from "@/app/components/shared/PageHeader";
import {
  agentsMessage,
  codeOf,
  createAgent,
  getMe,
  listAgents,
  patchConfig,
  toolsPage,
  type ApiClient,
} from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import { llmCovered } from "@/lib/agents/house";
import { knownKey } from "@/lib/agents/keys";
import { tomlFromGrants } from "@/lib/agents/mcpToml";
import {
  googleOAuthEnvKeys,
  googleOwnClientFlag,
  googlePlatformToolId,
  PLATFORM_GOOGLE_LINE,
} from "@/lib/agents/platform";
import { AGENT_SLUG, type AgentCard, type AgentCreate, type Grant, type ToolEntry } from "@/lib/agents/types";
import { assignHref } from "./follow";
import { alertClass, inputClass, labelClass, mainClass, primaryClass, quietClass } from "./Fold";
import { parseEnvPaste } from "./envPaste";
import { PERSONA_TEMPLATE, personaFor, scrubPersonaPlaceholders } from "./personaTemplate";

const LLM_ENV_KEYS = new Set(["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"]);

const STEPS = ["Name", "Persona", "Keys", "Tools"] as const;
const panelClass = `${cardClass} flex flex-col gap-4`;

function resolvedName(nameRaw: string, slug: string): string {
  const trimmed = nameRaw.trim();
  return trimmed || slug;
}

export function agentCreateCollision(
  agents: Pick<AgentCard, "slug" | "name">[],
  slugRaw: string,
  nameRaw: string,
): "exists" | "name_exists" | null {
  const slug = slugRaw.trim().toLowerCase();
  if (!AGENT_SLUG.test(slug)) {
    return null;
  }
  for (const agent of agents) {
    if (agent.slug === slug) {
      return "exists";
    }
  }
  const resolvedLower = resolvedName(nameRaw, slug).toLowerCase();
  for (const agent of agents) {
    const otherNameLower = agent.name.toLowerCase();
    if (otherNameLower === resolvedLower || agent.slug === resolvedLower || otherNameLower === slug) {
      return "name_exists";
    }
  }
  return null;
}

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

function discClass(n: number, step: number): string {
  if (n === step) {
    return "bg-accent text-canvas";
  }
  if (n < step) {
    return "bg-ok/20 text-ok";
  }
  return "bg-track text-dim";
}

function StepRail({ step }: { step: number }) {
  return (
    <ol aria-label="Steps" className="flex items-center">
      {STEPS.map((label, index) => {
        const n = index + 1;
        const last = n === STEPS.length;
        return (
          <li key={label} className={last ? "flex min-w-0 items-center" : "flex min-w-0 flex-1 items-center"}>
            <span
              aria-current={n === step ? "step" : undefined}
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${discClass(n, step)}`}
            >
              {n}
            </span>
            <span className={`ml-2 truncate text-xs font-medium ${n === step ? "text-fg" : "text-dim"}`}>{label}</span>
            {last
              ? null
              : <span aria-hidden className="mx-3 h-px min-w-3 flex-1 bg-line" />}
          </li>
        );
      })}
    </ol>
  );
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
  const [personaTouched, setPersonaTouched] = useState(false);
  const [creatorEmail, setCreatorEmail] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [extras, setExtras] = useState<{ id: number; key: string; value: string }[]>([]);
  const [nextExtra, setNextExtra] = useState(1);
  const [envPasteOpen, setEnvPasteOpen] = useState(false);
  const [envPasteRaw, setEnvPasteRaw] = useState("");
  const [envImportNote, setEnvImportNote] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolEntry[] | null>(null);
  const [house, setHouse] = useState<string[]>([]);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [ownGoogleClient, setOwnGoogleClient] = useState<Record<string, boolean>>({});
  const [needs, setNeeds] = useState<Record<string, string>>({});
  const [made, setMade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    void getMe(client).then((session) => {
      if (!dead) {
        setCreatorEmail(session.email);
      }
    }).catch(() => {
      /* persona still works without email */
    });
    return () => {
      dead = true;
    };
  }, [client]);

  useEffect(() => {
    let dead = false;
    void toolsPage(client).then((page) => {
      if (!dead) {
        setTools(page.tools);
        setHouse(page.house);
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
  const typedLlm: Record<string, string> = { LLM_BASE_URL: baseUrl.trim(), LLM_API_KEY: apiKey.trim(), LLM_MODEL: model.trim() };
  const keysOk = llmCovered(Object.keys(typedLlm).filter((key) => typedLlm[key]), house);
  const visible = (tools ?? []).filter((tool) => home || !tool.homeOnly);
  const nextDisabled = busy || (step === 1 && (!slugOk || !nameOk)) || (step === 3 && !keysOk);

  function wizardKeyValue(key: string): string {
    const llm = typedLlm[key];
    if (llm) {
      return llm;
    }
    if (house.includes(key)) {
      return "house";
    }
    for (const row of extras) {
      if (row.key.trim() === key && row.value.trim()) {
        return row.value.trim();
      }
    }
    return "";
  }

  function toolKeys(tool: ToolEntry): string[] {
    return [...tool.needs, ...tool.optional];
  }

  function typedNeedValue(toolId: string, key: string): string {
    return (needs[needId(toolId, key)] ?? "").trim();
  }

  async function forward() {
    setError(null);
    if (step === 1) {
      let agents: AgentCard[];
      try {
        agents = await listAgents(client);
      } catch (err: unknown) {
        setError(codeOf(err));
        return;
      }
      const collision = agentCreateCollision(agents, slug, name);
      if (collision) {
        setError(collision);
        return;
      }
      if (!personaTouched) {
        let email = creatorEmail;
        if (email === null) {
          try {
            email = (await getMe(client)).email;
            setCreatorEmail(email);
          } catch {
            /* persona still works without email */
          }
        }
        setPersona(personaFor({ agentName: name.trim(), email }));
      }
    }
    setStep((current) => current === 1 ? 2 : current === 2 ? 3 : 4);
  }

  function back() {
    setError(null);
    setStep((current) => current === 4 ? 3 : current === 3 ? 2 : 1);
  }

  function importEnvPaste() {
    setEnvImportNote(null);
    const { entries, skipped } = parseEnvPaste(envPasteRaw);
    if (entries.length === 0) {
      if (skipped.length > 0) {
        setEnvImportNote(`No keys imported. Skipped: ${skipped.join("; ")}`);
      }
      return;
    }
    for (const { key, value } of entries) {
      if (key === "LLM_BASE_URL") {
        setBaseUrl(value);
      } else if (key === "LLM_API_KEY") {
        setApiKey(value);
      } else if (key === "LLM_MODEL") {
        setModel(value);
      }
    }
    const extraEntries = entries.filter(({ key }) => !LLM_ENV_KEYS.has(key));
    const own: Record<string, boolean> = {};
    for (const toolId of ["google", "google-health"] as const) {
      if (extraEntries.some(({ key }) => googleOAuthEnvKeys(toolId).includes(key))) {
        own[toolId] = true;
      }
    }
    if (Object.keys(own).length > 0) {
      setOwnGoogleClient((prev) => ({ ...prev, ...own }));
    }
    if (extraEntries.length > 0) {
      let nextId = nextExtra;
      setExtras((rows) => {
        let maxId = Math.max(0, ...rows.map((row) => row.id), nextExtra - 1);
        const out = rows.map((row) => ({ ...row }));
        for (const { key, value } of extraEntries) {
          const idx = out.findIndex((row) => row.key.trim() === key);
          if (idx >= 0) {
            out[idx] = { ...out[idx], key, value };
          } else {
            maxId += 1;
            out.push({ id: maxId, key, value });
          }
        }
        nextId = maxId + 1;
        return out;
      });
      setNextExtra(nextId);
    }
    setEnvPasteRaw("");
    const skipPart = skipped.length > 0 ? ` Skipped: ${skipped.join("; ")}` : "";
    setEnvImportNote(`Imported ${entries.length} key${entries.length === 1 ? "" : "s"}.${skipPart}`);
  }

  function collectEnv(): Record<string, string> | null {
    // A blank LLM_* is not stored: the house value falls through in the config frame.
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(typedLlm)) {
      if (value) {
        env[key] = value;
      }
    }
    for (const row of extras) {
      const key = row.key.trim();
      if (key) {
        env[key] = row.value;
      }
    }
    for (const tool of visible) {
      if (!picked[tool.id]) {
        continue;
      }
      const own = googlePlatformToolId(tool.id) ? Boolean(ownGoogleClient[tool.id]) : false;
      if (own) {
        const flag = googleOwnClientFlag(tool.id);
        if (flag) {
          env[flag] = "1";
        }
      }
      for (const key of toolKeys(tool)) {
        if (googlePlatformToolId(tool.id) && !own && googleOAuthEnvKeys(tool.id).includes(key)) {
          continue;
        }
        const typed = typedNeedValue(tool.id, key);
        if (typed) {
          env[key] = typed;
        }
      }
    }
    const missing: string[] = [];
    for (const tool of visible) {
      if (!picked[tool.id]) {
        continue;
      }
      const own = googlePlatformToolId(tool.id) ? Boolean(ownGoogleClient[tool.id]) : false;
      for (const key of tool.needs) {
        if (googlePlatformToolId(tool.id) && !own && googleOAuthEnvKeys(tool.id).includes(key)) {
          continue;
        }
        const typed = typedNeedValue(tool.id, key);
        if (typed || house.includes(key)) {
          continue;
        }
        if (!(env[key] ?? "").trim()) {
          missing.push(`${tool.id} ${key}`);
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
      const personaOut = scrubPersonaPlaceholders(persona, { agentName: name.trim(), email: creatorEmail });
      await patchConfig(target, { env, persona: personaOut, mcp: tomlFromGrants(grants) }, client);
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
      void forward();
      return;
    }
    void create();
  }

  return (
    <main className={mainClass}>
      <PageHeader
        crumb={{ href: "/agents", label: "Agents" }}
        title="New agent"
        blurb={`Step ${step} of 4 — ${STEPS[step - 1]}`}
      />
      <StepRail step={step} />

      {error ? <p role="alert" className={alertClass}>{agentsMessage(error)}</p> : null}
      {toolsError && step === 4 ? <p role="alert" className={alertClass}>{agentsMessage(toolsError)}</p> : null}

      <form aria-label="New agent" className="flex flex-col gap-4" onSubmit={onSubmit}>
        {step === 1
          ? (
              <div className={panelClass}>
                <div className="flex flex-col gap-1">
                  <label htmlFor="agent-slug" className={labelClass}>Agent ID</label>
                  <input
                    id="agent-slug"
                    value={slug}
                    disabled={made !== null}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="ada"
                    onChange={(e) => setSlug(e.target.value)}
                    className={inputClass}
                  />
                  <p className="text-xs text-dim">lowercase letters, digits, dashes — used in the chat URL</p>
                  {slug.length > 0 && !slugOk
                    ? <p className="text-xs text-danger">Use a letter, then lowercase letters, digits, or hyphens.</p>
                    : null}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="agent-name" className={labelClass}>Shown as</label>
                  <input
                    id="agent-name"
                    value={name}
                    disabled={made !== null}
                    autoComplete="off"
                    placeholder="Ada"
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
              </div>
            )
          : null}

        {step === 2
          ? (
              <div className={panelClass}>
                <div className="flex flex-col gap-1">
                  <label htmlFor="agent-persona" className={labelClass}>Persona</label>
                  <textarea
                    id="agent-persona"
                    value={persona}
                    rows={16}
                    onChange={(e) => {
                      setPersonaTouched(true);
                      setPersona(e.target.value);
                    }}
                    className={`${inputClass} min-h-64 font-mono text-xs`}
                  />
                </div>
              </div>
            )
          : null}

        {step === 3
          ? (
              <div className={panelClass}>
                <p className="text-xs text-dim">Write-only. The agent stores them; this form will not show them again.</p>
                {house.length > 0
                  ? (
                      <p role="note" className="text-xs text-dim">
                        House keys on the server: {house.join(", ")}. Leave a field blank to use the house value.
                      </p>
                    )
                  : null}
                <div className="flex flex-col gap-1">
                  <label htmlFor="llm-base" className={labelClass}>LLM_BASE_URL</label>
                  <input id="llm-base" value={baseUrl} autoComplete="off" spellCheck={false} placeholder={house.includes("LLM_BASE_URL") ? "house" : undefined} onChange={(e) => setBaseUrl(e.target.value)} className={inputClass} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="llm-key" className={labelClass}>LLM_API_KEY</label>
                  <input id="llm-key" type="password" value={apiKey} autoComplete="new-password" spellCheck={false} placeholder={house.includes("LLM_API_KEY") ? "house" : undefined} onChange={(e) => setApiKey(e.target.value)} className={inputClass} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="llm-model" className={labelClass}>LLM_MODEL</label>
                  <input id="llm-model" value={model} autoComplete="off" spellCheck={false} placeholder={house.includes("LLM_MODEL") ? "house" : undefined} onChange={(e) => setModel(e.target.value)} className={inputClass} />
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
                <button
                  type="button"
                  aria-expanded={envPasteOpen}
                  onClick={() => setEnvPasteOpen((open) => !open)}
                  className={quietClass}
                >
                  Import a .env
                </button>
                {envPasteOpen
                  ? (
                      <div className="flex flex-col gap-1 border-t border-line pt-4">
                        <label htmlFor="agent-env-paste" className={labelClass}>Paste env</label>
                        <textarea
                          id="agent-env-paste"
                          value={envPasteRaw}
                          rows={4}
                          spellCheck={false}
                          autoComplete="off"
                          placeholder="GARMIN_EMAIL=you@example.com"
                          onChange={(e) => {
                            setEnvPasteRaw(e.target.value);
                            setEnvImportNote(null);
                          }}
                          className={`${inputClass} font-mono text-xs`}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" onClick={importEnvPaste} className={quietClass}>
                            Import keys
                          </button>
                          {envImportNote ? <p role="status" className="text-xs text-dim">{envImportNote}</p> : null}
                        </div>
                      </div>
                    )
                  : null}
              </div>
            )
          : null}

        {step === 4
          ? (
              <div className={panelClass}>
                {tools === null && !toolsError ? <p className="text-sm text-muted">Loading tools.</p> : null}
                {tools !== null && visible.length === 0 ? <p className="text-sm text-muted">No tools to show.</p> : null}
                {visible.map((tool) => {
                  const on = Boolean(picked[tool.id]);
                  const ownClient = Boolean(ownGoogleClient[tool.id]);
                  const showGoogleKeys = !googlePlatformToolId(tool.id) || ownClient;
                  return (
                    <div key={tool.id} className="rounded-xl border border-line bg-canvas/50 px-3 py-3">
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
                      {on && googlePlatformToolId(tool.id)
                        ? (
                            <>
                              <label className="mt-2 flex items-center gap-2 text-xs text-fg">
                                <input
                                  type="checkbox"
                                  checked={ownClient}
                                  onChange={(e) => setOwnGoogleClient((prev) => ({ ...prev, [tool.id]: e.target.checked }))}
                                />
                                Use my own client
                              </label>
                              {!ownClient ? <p className="mt-1 text-xs text-dim">{PLATFORM_GOOGLE_LINE}</p> : null}
                            </>
                          )
                        : null}
                      {on && showGoogleKeys
                        ? toolKeys(tool).map((key) => {
                            const optional = tool.optional.includes(key);
                            if (googlePlatformToolId(tool.id) && !ownClient && googleOAuthEnvKeys(tool.id).includes(key)) {
                              return null;
                            }
                            if (wizardKeyValue(key)) {
                              return (
                                <div key={key} className="mt-2 flex flex-col gap-1">
                                  <span className={`${labelClass} flex items-center gap-2`}>
                                    <span className="font-mono text-body">{key}</span>
                                    <span className={`${chipClass} border-ok/40 bg-ok/10 text-ok`}>set</span>
                                  </span>
                                </div>
                              );
                            }
                            const inputType = knownKey(key)?.kind === "text" ? "text" : "password";
                            return (
                              <div key={key} className="mt-2 flex flex-col gap-1">
                                <label htmlFor={`need-${tool.id}-${key}`} className={`${labelClass} flex items-center gap-2`}>
                                  <span className="font-mono text-body">{key}</span>
                                  {optional
                                    ? <span className={`${chipClass} border-line bg-canvas/60 text-dim`}>default</span>
                                    : null}
                                </label>
                                <input
                                  id={`need-${tool.id}-${key}`}
                                  type={inputType}
                                  autoComplete="new-password"
                                  spellCheck={false}
                                  placeholder={optional ? "optional" : undefined}
                                  value={needs[needId(tool.id, key)] ?? ""}
                                  onChange={(e) => setNeeds((prev) => ({ ...prev, [needId(tool.id, key)]: e.target.value }))}
                                  className={inputClass}
                                />
                              </div>
                            );
                          })
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
