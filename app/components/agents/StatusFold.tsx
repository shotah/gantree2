"use client";

import { useState } from "react";
import type { AgentStatus } from "@/lib/agents/types";
import { Fold } from "./Fold";
import { relativeTime, timeStamp } from "./relativeTime";

export function StatusFold({ status }: { status: AgentStatus | null }) {
  const [open, setOpen] = useState(true);
  const harness = status ? status.harness : "unknown";

  return (
    <Fold title="Status" open={open} onOpen={setOpen} hint={harness}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${harness === "connected" ? "bg-ok" : "bg-faint"}`} />
        <span className="text-fg">{harness}</span>
        {status?.since != null
          ? <time dateTime={timeStamp(status.since)} className="text-xs text-dim">since {relativeTime(status.since)}</time>
          : null}
      </div>
      {status?.lastError
        ? (
            <p aria-label="Last error" className="mt-1 break-words font-mono text-xs text-danger">
              <time dateTime={status.lastError.at} className="mr-2 text-dim">{status.lastError.at}</time>
              {status.lastError.message}
            </p>
          )
        : null}
      {status
        ? (
            <p className="mt-2 text-xs text-muted">
              Last turn <time dateTime={timeStamp(status.lastTurn)}>{relativeTime(status.lastTurn)}</time>
            </p>
          )
        : <p className="mt-2 text-sm text-muted">No status yet.</p>}
      {status
        ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <h3 className="text-xs font-medium text-fg">Published</h3>
                {status.published.length === 0
                  ? <p className="mt-1 text-xs text-dim">Nothing published.</p>
                  : (
                      <ul aria-label="Published" className="mt-1 space-y-1 text-sm text-body">
                        {status.published.map((name) => <li key={name}>{name}</li>)}
                      </ul>
                    )}
              </div>
              <div>
                <h3 className="text-xs font-medium text-fg">Skipped</h3>
                {status.skipped.length === 0
                  ? <p className="mt-1 text-xs text-dim">Nothing skipped.</p>
                  : (
                      <ul aria-label="Skipped" className="mt-1 space-y-1 text-sm text-danger">
                        {status.skipped.map((item) => (
                          <li key={item.name}>{item.name}: {item.reason}</li>
                        ))}
                      </ul>
                    )}
              </div>
            </div>
          )
        : null}
    </Fold>
  );
}
