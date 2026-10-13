import type { Logger } from "@/harness/core/log";
import { silentLogger } from "@/harness/core/log";
import {
  DefaultExamplesSkipRecentMs,
  DueBatch,
  KindDailyPlanner,
  KindExamples,
  KindExamplesPing,
  KindFollowUp,
  MaxWaitNudges,
  SubjectHours,
  KindPreference,
} from "./constants";
import { asleepAt } from "./hours";
import { formatJobMemory, resolvePin } from "./pins";
import {
  DailyPlannerPrefix,
  DefaultDailyPlannerPrompt,
  ExamplesPingPrefix,
  JobUserPrefix,
} from "./prompts";
import { parseSpread, planSpreadTimes } from "./spread";
import { formatDuration, zoneOrUtc } from "./time";
import type {
  ExamplePromptBuilder,
  FireOutcome,
  Job,
  JobHandler,
  JobTurn,
  MemoryLookup,
  Pusher,
  RecentUserActivity,
  TalkState,
  TalkStore,
} from "./types";
import { followUpPrefix, nextFollowUpDelay, stripWaitTokens } from "./wait";
import { isSilentReply } from "./silent";
import type { Store } from "./store";

export type RunnerOptions = {
  store?: Store;
  push?: Pusher;
  log?: Logger;
  recent?: RecentUserActivity;
  /** Defaults to 60 minutes (`EXAMPLES_SKIP_RECENT_MINUTES`). */
  examplesSkipRecentMs?: number;
  examples?: ExamplePromptBuilder;
  memory?: MemoryLookup;
  talk?: TalkStore;
};

/**
 * Fires due jobs when the Durable Object's alarm rings.
 * There is no ticker: after every mutation call `nextDue()` and `setAlarm`.
 * At the start of `fireDue`, `clearStaleRunning` drops any `running=1` claim:
 * the DO runs at most one `alarm()` at a time and only that handler calls
 * `fireDue`, so a live claim cannot exist when the next alarm starts.
 */
export class Runner {
  constructor(private readonly opts: RunnerOptions = {}) {}

  private get log(): Logger {
    return this.opts.log ?? silentLogger;
  }

  nextDue(): number | null {
    return this.opts.store?.nextDue() ?? null;
  }

  /** Process start. Safe to call again; `fireDue` clears leftovers too. */
  boot(): number {
    const n = this.opts.store?.clearStaleRunning() ?? 0;
    if (n > 0) this.log.info("cron cleared stale running flags", { count: n });
    return n;
  }

  async fireDue(now: number, handle: JobHandler): Promise<FireOutcome[]> {
    const store = this.opts.store;
    if (!store) return [];
    const cleared = store.clearStaleRunning();
    if (cleared > 0) this.log.info("cron cleared stale running flags", { count: cleared });
    let jobs: Job[];
    try {
      jobs = store.due(now, DueBatch);
    } catch (err) {
      this.log.warn("cron due query failed", { err: errText(err) });
      return [];
    }
    const out: FireOutcome[] = [];
    for (const job of jobs) {
      try {
        if (!store.claim(job.id, now)) continue;
      } catch (err) {
        this.log.warn("cron claim failed", { id: job.id, err: errText(err) });
        continue;
      }
      out.push(await this.runOne(now, handle, job));
    }
    return out;
  }

  private async runOne(now: number, handle: JobHandler, job: Job): Promise<FireOutcome> {
    const store = this.opts.store;
    if (!store) return { id: job.id, kind: job.kind, outcome: "error" };
    this.log.info("cron job firing", {
      id: job.id,
      kind: job.kind,
      session_id: job.sessionId,
      memory_id: job.memoryId,
      prompt: truncate(job.prompt, 80),
    });

    if (job.kind === KindExamples) return this.runExamplesPlanner(now, job);

    if ((job.kind === KindExamplesPing || job.kind === KindFollowUp) && await this.asleep(job, now)) {
      const until = now + 3_600_000;
      this.log.info("cron ping deferred (sleep hours)", {
        id: job.id,
        kind: job.kind,
        session_id: job.sessionId,
        until,
      });
      store.defer(job.id, until, "skipped: sleep hours");
      return { id: job.id, kind: job.kind, outcome: "defer" };
    }

    if (job.kind === KindExamplesPing && this.opts.recent) {
      const skipFor = this.skipRecentMs();
      try {
        const active = await this.opts.recent(job.sessionId, now - skipFor);
        if (active) {
          if (job.lastError.startsWith("skipped:")) {
            this.log.info("cron ping skipped after defer (recent chat); dropping", {
              id: job.id,
              kind: job.kind,
              session_id: job.sessionId,
            });
            store.finish(job, null);
            return { id: job.id, kind: job.kind, outcome: "skip" };
          }
          const until = now + skipFor;
          this.log.info("cron ping deferred (recent chat)", {
            id: job.id,
            kind: job.kind,
            session_id: job.sessionId,
            until,
          });
          store.defer(job.id, until, `skipped: user active in last ${formatDuration(skipFor)}`);
          return { id: job.id, kind: job.kind, outcome: "defer" };
        }
      } catch (err) {
        this.log.warn("cron recent-chat check failed", { id: job.id, kind: job.kind, err: errText(err) });
      }
    }

    if (job.kind === KindExamplesPing && await this.waitingActive(job.sessionId)) {
      this.log.info("cron ping skipped (waiting for reply)", {
        id: job.id,
        kind: job.kind,
        session_id: job.sessionId,
      });
      store.finish(job, null);
      return { id: job.id, kind: job.kind, outcome: "skip" };
    }

    if (job.kind === KindFollowUp && await this.skipFollowUp(job.sessionId)) {
      this.log.info("cron follow-up skipped (wait cleared or exhausted)", {
        id: job.id,
        session_id: job.sessionId,
      });
      store.finish(job, null);
      return { id: job.id, kind: job.kind, outcome: "skip" };
    }

    let prefix = JobUserPrefix;
    let prompt = job.prompt;
    let noTools = false;
    if (job.kind === KindDailyPlanner) {
      prefix = DailyPlannerPrefix;
      if (!prompt.trim()) prompt = DefaultDailyPlannerPrompt;
    } else if (job.kind === KindExamplesPing) {
      prefix = ExamplesPingPrefix;
      if (this.opts.examples) prompt = await this.opts.examples();
      noTools = true;
    } else if (job.kind === KindFollowUp) {
      let nudge = 0;
      if (this.opts.talk) {
        try {
          const st = await this.opts.talk.talkState(job.sessionId);
          nudge = st.waitNudges;
        } catch {
          nudge = 0;
        }
      }
      prefix = followUpPrefix(nudge, MaxWaitNudges);
    }

    const turn: JobTurn = {
      sessionId: job.sessionId,
      text: prefix + await this.jobMemoryBlock(job) + prompt,
      noTools,
      photos: [],
    };
    let reply: string;
    try {
      reply = await handle(turn);
    } catch (err) {
      this.log.warn("cron job handle failed", {
        id: job.id,
        kind: job.kind,
        session_id: job.sessionId,
        err: errText(err),
        outcome: "error",
      });
      store.finish(job, err instanceof Error ? err : new Error(errText(err)));
      return { id: job.id, kind: job.kind, outcome: "error" };
    }

    reply = stripWaitTokens(reply);
    if (job.kind === KindFollowUp && await this.humanRepliedDuring(job.sessionId, now)) {
      this.log.info("cron follow-up dropped (user replied during turn)", {
        id: job.id,
        kind: job.kind,
        session_id: job.sessionId,
        outcome: "drop",
      });
      try {
        store.finish(job, null);
      } catch (err) {
        this.log.warn("cron finish failed", { id: job.id, err: errText(err) });
      }
      return { id: job.id, kind: job.kind, outcome: "drop" };
    }

    const photos = turn.photos.map((p) => p.trim()).filter((p) => p !== "");
    if (isSilentReply(reply)) {
      this.log.info("cron silent skip", {
        id: job.id,
        kind: job.kind,
        session_id: job.sessionId,
        outcome: "silent",
        reply_chars: reply.length,
      });
    } else if (reply !== "" || photos.length > 0) {
      const frameId = `cron-${job.id}-${now}`;
      try {
        if (!this.opts.push) throw new Error("cron: no pusher");
        await this.opts.push({ text: reply, photos, id: frameId });
      } catch (err) {
        this.log.warn("cron push failed", {
          id: job.id,
          kind: job.kind,
          session_id: job.sessionId,
          err: errText(err),
          outcome: "error",
          frame_id: frameId,
        });
        store.finish(job, new Error(`push: ${errText(err)}`));
        return { id: job.id, kind: job.kind, outcome: "error", frameId };
      }
      this.log.info("cron job pushed", {
        id: job.id,
        kind: job.kind,
        session_id: job.sessionId,
        outcome: "push",
        frame_id: frameId,
        reply_chars: reply.length,
      });
      if (job.kind === KindFollowUp) await this.afterFollowUp(job, now);
      try {
        store.finish(job, null);
      } catch (err) {
        this.log.warn("cron finish failed", { id: job.id, err: errText(err) });
      }
      return { id: job.id, kind: job.kind, outcome: "push", frameId };
    } else {
      this.log.info("cron empty reply", {
        id: job.id,
        kind: job.kind,
        session_id: job.sessionId,
        outcome: "silent",
      });
    }

    if (job.kind === KindFollowUp) await this.afterFollowUp(job, now);
    try {
      store.finish(job, null);
    } catch (err) {
      this.log.warn("cron finish failed", { id: job.id, err: errText(err) });
    }
    return { id: job.id, kind: job.kind, outcome: "silent" };
  }

  private async waitingActive(sessionId: string): Promise<boolean> {
    const st = await this.readTalk(sessionId);
    if (!st?.waitingForReply) return false;
    return st.waitNudges < MaxWaitNudges;
  }

  private async skipFollowUp(sessionId: string): Promise<boolean> {
    if (!this.opts.talk) return false;
    let st: TalkState;
    try {
      st = await this.opts.talk.talkState(sessionId);
    } catch {
      return false;
    }
    return !st.waitingForReply || st.waitNudges >= MaxWaitNudges;
  }

  private async readTalk(sessionId: string): Promise<TalkState | null> {
    if (!this.opts.talk) return null;
    try {
      return await this.opts.talk.talkState(sessionId);
    } catch {
      return null;
    }
  }

  private async humanRepliedDuring(sessionId: string, now: number): Promise<boolean> {
    if (!this.opts.recent) return false;
    try {
      return await this.opts.recent(sessionId, now - 60_000);
    } catch {
      return false;
    }
  }

  private async afterFollowUp(job: Job, now: number): Promise<void> {
    const talk = this.opts.talk;
    const store = this.opts.store;
    if (!talk || !store) return;
    let st: TalkState;
    try {
      st = await talk.talkState(job.sessionId);
    } catch (err) {
      this.log.warn("cron follow-up talk state", { id: job.id, err: errText(err) });
      return;
    }
    if (!st.waitingForReply) return;
    try {
      st = await talk.bumpWaitNudge(job.sessionId);
    } catch (err) {
      this.log.warn("cron follow-up bump failed", { id: job.id, err: errText(err) });
      return;
    }
    const delay = nextFollowUpDelay(st.waitNudges);
    if (delay == null || !st.waitingForReply) return;
    try {
      store.scheduleFollowUp({ sessionId: job.sessionId }, job.timezone || "UTC", now + delay);
    } catch (err) {
      this.log.warn("cron follow-up reschedule failed", { id: job.id, err: errText(err) });
    }
  }

  private async jobMemoryBlock(job: Job): Promise<string> {
    const memory = this.opts.memory;
    if (!memory) return "";
    if (!job.memoryId && !job.memorySubject.trim()) return "";
    const row = await resolvePin(memory, job.memoryId, job.memorySubject);
    if (!row) {
      this.log.warn("cron job memory missing; running on prompt", {
        id: job.id,
        memory_id: job.memoryId,
        subject: job.memorySubject,
      });
      return "";
    }
    return formatJobMemory(row.kind, row.subject, row.content);
  }

  private async asleep(job: Job, now: number): Promise<boolean> {
    const memory = this.opts.memory;
    if (!memory) return false;
    try {
      const row = await memory.activeByKindSubject(KindPreference, SubjectHours);
      if (!row) return false;
      return asleepAt(row.content, now, zoneOrUtc(job.timezone));
    } catch {
      return false;
    }
  }

  private skipRecentMs(): number {
    const n = this.opts.examplesSkipRecentMs ?? 0;
    return n > 0 ? n : DefaultExamplesSkipRecentMs;
  }

  private runExamplesPlanner(now: number, job: Job): FireOutcome {
    const store = this.opts.store;
    if (!store) return { id: job.id, kind: job.kind, outcome: "error" };
    let spec;
    try {
      spec = parseSpread(job.expr);
    } catch (err) {
      this.log.warn("examples planner bad expr", { id: job.id, err: errText(err) });
      store.finish(job, err instanceof Error ? err : new Error(errText(err)));
      return { id: job.id, kind: job.kind, outcome: "error" };
    }
    const loc = zoneOrUtc(job.timezone);
    store.cancelExamplesPings(job.sessionId);
    let planned: { n: number; times: number[] };
    try {
      planned = planSpreadTimes(spec, loc, now);
    } catch (err) {
      this.log.warn("examples planner plan failed", { id: job.id, err: errText(err) });
      store.finish(job, err instanceof Error ? err : new Error(errText(err)));
      return { id: job.id, kind: job.kind, outcome: "error" };
    }
    let created: number;
    try {
      created = store.scheduleExamplesPings(job.prompt, { sessionId: job.sessionId }, loc, planned.times);
    } catch (err) {
      this.log.warn("examples planner schedule pings failed", { id: job.id, err: errText(err) });
      store.finish(job, err instanceof Error ? err : new Error(errText(err)));
      return { id: job.id, kind: job.kind, outcome: "error" };
    }
    this.log.info("examples planner seeded day", {
      id: job.id,
      qty: planned.n,
      pings: created,
      session_id: job.sessionId,
    });
    try {
      store.finish(job, null);
    } catch (err) {
      this.log.warn("examples planner finish failed", { id: job.id, err: errText(err) });
    }
    return { id: job.id, kind: job.kind, outcome: "seed" };
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
