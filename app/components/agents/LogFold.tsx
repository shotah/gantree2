"use client";

import { useEffect, useRef, useState } from "react";
import { agentsMessage, codeOf, getLog, type ApiClient } from "@/app/lib/agentsHttp";
import { api } from "@/app/lib/api";
import type { LogLine } from "@/lib/agents/types";
import { alertClass, Fold } from "./Fold";

export const LOG_POLL_MS = 3_000;

export function levelClass(level: string): string {
  const name = level.toLowerCase();
  if (name === "error" || name === "fatal" || name === "panic") {
    return "text-danger";
  }
  if (name === "warn" || name === "warning") {
    return "text-mark";
  }
  if (name === "debug" || name === "trace") {
    return "text-dim";
  }
  if (name === "info") {
    return "text-body";
  }
  return "text-muted";
}

export function droppedCount(lines: readonly LogLine[]): number {
  return lines.reduce((sum, line) => sum + (typeof line.dropped === "number" ? line.dropped : 0), 0);
}

function append(prev: LogLine[], lines: LogLine[]): LogLine[] {
  const seen = new Set(prev.map((line) => line.seq));
  const extra = lines.filter((line) => !seen.has(line.seq));
  return extra.length > 0 ? [...prev, ...extra] : prev;
}

export function LogFold({
  slug,
  client = api,
  pollMs = LOG_POLL_MS,
}: {
  slug: string;
  client?: ApiClient;
  pollMs?: number;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!open) {
      cursor.current = undefined;
      return;
    }
    let dead = false;
    cursor.current = undefined;
    setLines([]);
    setError(null);
    const pull = async () => {
      if (dead || document.visibilityState === "hidden") {
        return;
      }
      try {
        const page = await getLog(slug, cursor.current, client);
        if (dead) {
          return;
        }
        cursor.current = page.next;
        setLines((prev) => append(prev, page.lines));
        setError(null);
      } catch (err) {
        if (!dead) {
          setError(codeOf(err));
        }
      }
    };
    void pull();
    const id = window.setInterval(() => {
      void pull();
    }, pollMs);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void pull();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      dead = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [open, slug, client, pollMs]);

  const dropped = droppedCount(lines);

  return (
    <Fold title="Log" open={open} onOpen={setOpen} hint="tail">
      {error ? <p role="alert" className={`${alertClass} mb-3`}>{agentsMessage(error)}</p> : null}
      {dropped > 0
        ? <p className="mb-2 text-xs text-mark">{dropped === 1 ? "1 line dropped" : `${dropped} lines dropped`}</p>
        : null}
      {lines.length === 0
        ? <p className="text-sm text-muted">No log lines yet.</p>
        : (
            <ol aria-label="Log lines" className="space-y-1 font-mono text-xs">
              {lines.map((line) => (
                <li key={line.seq} className={levelClass(line.level)}>
                  <span className="mr-2 text-dim">{line.at}</span>
                  <span className="mr-2 uppercase">{line.level}</span>
                  <span>{line.message}</span>
                </li>
              ))}
            </ol>
          )}
    </Fold>
  );
}
