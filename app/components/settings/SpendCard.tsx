"use client";

import { useEffect, useMemo, useState } from "react";
import { cardClass } from "@/app/components/shared/PageHeader";
import { api } from "@/app/lib/api";
import {
  browserSpendRate,
  fmtTokens,
  fmtUsd,
  parseSamples,
  parseSpendRate,
  rollupSamples,
  samplesQuery,
  saveSpendRate,
  windowStart,
  SPEND_WINDOWS,
  type SpendWindow,
} from "@/app/lib/spend";
import { displaySlug } from "@/lib/chat/slug";
import type { SampleRow } from "@/lib/door/settingsStore";

export type ApiClient = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const WINDOW_LABEL: Record<SpendWindow, string> = {
  today: "Today",
  "7d": "7d",
  "30d": "30d",
};

function barWidth(part: number, peak: number): string {
  if (peak <= 0) {
    return "0%";
  }
  return `${(part / peak) * 100}%`;
}

function TotalTile({ label, value, money = false }: { label: string; value: string; money?: boolean }) {
  return (
    <div className={`min-w-[5.5rem] flex-1 overflow-hidden rounded-xl bg-canvas/50 px-3 py-2 ${money ? "border border-ok/40" : "border border-line"}`}>
      <p className={`truncate text-lg font-semibold tabular-nums ${money ? "text-ok" : "text-fg"}`}>{value}</p>
      <p className="truncate text-[11px] text-muted">{label}</p>
    </div>
  );
}

export function SpendCard({
  agents,
  client = api,
  framed = true,
}: {
  /** `null` loads every agent (admin). A list loads those slugs. */
  agents: readonly string[] | null;
  client?: ApiClient;
  /** `false` drops the card frame and landmark so a parent fold can supply them. */
  framed?: boolean;
}) {
  const Root = framed ? "section" : "div";
  const scope = agents === null ? "all" : agents.filter(Boolean).join("\0");
  const [window, setWindow] = useState<SpendWindow>("today");
  const [samples, setSamples] = useState<SampleRow[]>([]);
  const [rateText, setRateText] = useState("");
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = browserSpendRate();
    if (saved != null) {
      setRateText(String(saved));
    }
  }, []);

  useEffect(() => {
    if (scope !== "all" && scope.length === 0) {
      setSamples([]);
      setError(null);
      setPhase("ready");
      return;
    }
    let dead = false;
    const since = windowStart("30d");
    const urls = scope === "all"
      ? [samplesQuery(since)]
      : scope.split("\0").map((agent) => samplesQuery(since, agent));
    setPhase("loading");
    void Promise.all(urls.map(async (url) => {
      const res = await client(url);
      if (res.status === 403) {
        throw new Error("forbidden");
      }
      if (!res.ok) {
        throw new Error("request_failed");
      }
      return parseSamples(await res.json());
    }))
      .then((groups) => {
        if (dead) {
          return;
        }
        setSamples(groups.flat());
        setError(null);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (dead) {
          return;
        }
        setSamples([]);
        setError(err instanceof Error && err.message === "forbidden"
          ? "Spend is for admins and operators."
          : "Could not load samples.");
        setPhase("ready");
      });
    return () => {
      dead = true;
    };
  }, [client, scope]);

  const rate = parseSpendRate(rateText);
  const rollup = useMemo(() => rollupSamples(samples, window, rate), [samples, window, rate]);
  const peak = rollup.agents.reduce((max, row) => Math.max(max, row.prompt + row.completion), 0);

  function onRate(raw: string) {
    setRateText(raw);
    if (raw.trim() === "") {
      saveSpendRate(null);
      return;
    }
    const parsed = parseSpendRate(raw);
    if (parsed != null) {
      saveSpendRate(parsed);
    }
  }

  const idle = agents !== null && agents.filter(Boolean).length === 0;

  return (
    <Root aria-label={framed ? "Spend" : undefined} className={framed ? cardClass : undefined}>
      <div className={`flex flex-wrap items-start gap-3 ${framed ? "justify-between" : "justify-end"}`}>
        {framed ? <h2 className="text-sm font-medium text-fg">Spend</h2> : null}
        <div className="inline-flex gap-0.5 rounded-full bg-track p-0.5" role="group" aria-label="Spend window">
          {SPEND_WINDOWS.map((item) => {
            const on = window === item;
            return (
              <button
                key={item}
                type="button"
                aria-pressed={on}
                onClick={() => setWindow(item)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${on ? "bg-accent text-canvas" : "text-dim hover:text-body"}`}
              >
                {WINDOW_LABEL[item]}
              </button>
            );
          })}
        </div>
      </div>

      <label htmlFor="spend-rate" className="mt-3 flex flex-col gap-1 text-xs text-muted">
        $ / 1M tokens
        <input
          id="spend-rate"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={rateText}
          placeholder="2.50"
          onChange={(e) => onRate(e.target.value)}
          className="w-32 rounded-xl border border-line bg-canvas px-3 py-1.5 text-sm text-body"
        />
      </label>
      <p className="mt-1 text-[11px] text-dim">One rate for prompt and completion. It stays in this browser.</p>

      {idle
        ? <p className="mt-3 text-sm text-dim">No agents on your row.</p>
        : null}

      {phase === "loading" && !idle
        ? <p className="mt-3 text-sm text-muted">Loading spend.</p>
        : null}

      {error
        ? <p role="alert" className="mt-3 rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
        : null}

      {phase === "ready" && !idle && !error && rollup.agents.length === 0
        ? <p className="mt-3 text-sm text-dim">No usage in this window.</p>
        : null}

      {phase === "ready" && !error && rollup.agents.length > 0
        ? (
            <>
              <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Spend totals">
                <TotalTile label="prompt" value={fmtTokens(rollup.prompt)} />
                <TotalTile label="completion" value={fmtTokens(rollup.completion)} />
                <TotalTile label="turns" value={String(rollup.turns)} />
                {rollup.usd != null
                  ? <TotalTile label="cost" value={fmtUsd(rollup.usd)} money />
                  : null}
              </div>
              <ul className="mt-3 space-y-2" aria-label="Spend by agent">
                {rollup.agents.map((row) => (
                  <li key={row.agent} aria-label={row.agent} className="rounded-xl border border-line bg-canvas/40 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-fg">{displaySlug(row.agent)}</span>
                      <span className="tabular-nums text-body">
                        {fmtTokens(row.prompt)} prompt · {fmtTokens(row.completion)} completion
                        {row.usd != null ? <span className="text-ok"> · {fmtUsd(row.usd)}</span> : null}
                      </span>
                    </div>
                    <p className="text-[11px] text-dim">{row.turns} {row.turns === 1 ? "turn" : "turns"}</p>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-track">
                      <div
                        aria-hidden
                        className="h-full rounded-full bg-gradient-to-r from-accent to-mark"
                        style={{ width: barWidth(row.prompt + row.completion, peak) }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )
        : null}
    </Root>
  );
}
