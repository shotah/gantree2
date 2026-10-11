import { fixedClock, type Clock } from "@/brain/core/clock";
import { nodeSql, type NodeDatabase, type Sql } from "@/brain/core/sql";
import { openStore, type Store } from "@/brain/cron/store";
import type { MemoryLookup, MemoryPin, TalkState, TalkStore } from "@/brain/cron/types";
import { DatabaseSync } from "node:sqlite";

export function openCron(max = 50, at = Date.now(), zone = "UTC"): { sql: Sql; clock: Clock & { set(at: number): void; tick(ms: number): void }; store: Store } {
  const sql = nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase);
  const clock = fixedClock(at, zone);
  return { sql, clock, store: openStore(sql, clock, max) };
}

export function reopen(sql: Sql, clock: Clock, max = 50): Store {
  return openStore(sql, clock, max);
}

export function countKind(store: Store, kind: string): number {
  return store.list(false).filter((job) => job.kind === kind).length;
}

export function fakeTalk(): TalkStore {
  const states = new Map<string, TalkState>();
  const blank = (): TalkState => ({
    lastSpeaker: "",
    waitingForReply: false,
    waitNudges: 0,
    waitSetAt: null,
  });
  return {
    talkState(id) {
      return states.get(id) ?? blank();
    },
    armWait(id) {
      states.set(id, { lastSpeaker: "agent", waitingForReply: true, waitNudges: 0, waitSetAt: 0 });
    },
    clearWait(id) {
      states.set(id, { ...blank(), lastSpeaker: states.get(id)?.lastSpeaker ?? "" });
    },
    bumpWaitNudge(id) {
      const st = states.get(id) ?? blank();
      if (!st.waitingForReply) return st;
      const next = { ...st, waitNudges: st.waitNudges + 1 };
      states.set(id, next);
      return next;
    },
  };
}

export function fakeMemory(): MemoryLookup & {
  store(kind: string, subject: string, content: string): MemoryPin;
  forget(id: number): void;
} {
  let next = 1;
  const rows = new Map<number, MemoryPin>();
  return {
    get(id) {
      return rows.get(id) ?? null;
    },
    activeByKindSubject(kind, subject) {
      for (const row of rows.values()) {
        if (row.kind === kind && row.subject === subject && row.supersededBy == null) return row;
      }
      return null;
    },
    store(kind, subject, content) {
      const id = next;
      next += 1;
      for (const row of rows.values()) {
        if (row.kind === kind && row.subject === subject && row.supersededBy == null) row.supersededBy = id;
      }
      const pin: MemoryPin = { id, kind, subject, content, supersededBy: null };
      rows.set(id, pin);
      return pin;
    },
    forget(id) {
      rows.delete(id);
    },
  };
}
