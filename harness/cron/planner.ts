import { DefaultPlannerAt, PlannerOff } from "./constants";
import { DailyPlannerMarker, DefaultDailyPlannerPrompt } from "./prompts";
import { formatPlannerAt, parsePlannerAt, parsePlannerSchedule } from "./schedule";
import type { Store } from "./store";
import { zoneOrUtc } from "./time";
import type { Delivery, Job } from "./types";

export type PlannerOptions = {
  store: Store | null;
  /** IANA zone. Invalid names fall back to UTC. */
  zone: string;
  /** Operator default (`DAILY_PLANNER_AT`). Empty uses 07:10. */
  at?: string;
  /** Overrides the kernel body. Empty uses the default prompt. */
  prompt?: string;
};

export class PlannerService {
  constructor(private readonly opts: PlannerOptions) {}

  proactiveEnabled(): boolean {
    return this.opts.store != null;
  }

  defaultAt(): string {
    const at = (this.opts.at ?? "").trim();
    if (!at) return DefaultPlannerAt;
    try {
      const { hour, minute } = parsePlannerAt(at);
      return formatPlannerAt(hour, minute);
    } catch {
      return DefaultPlannerAt;
    }
  }

  sessionAt(sessionId: string): string {
    if (!this.opts.store) throw new Error("planner: not configured");
    return this.opts.store.plannerAt(sessionId);
  }

  /** Session clock, or the operator default. `"0"` means off. */
  resolvedAt(sessionId: string): string {
    const pref = this.sessionAt(sessionId);
    if (pref === PlannerOff) return PlannerOff;
    if (pref) {
      try {
        const { hour, minute } = parsePlannerAt(pref);
        return formatPlannerAt(hour, minute);
      } catch {
        // Not a clock: inherit the operator default.
      }
    }
    return this.defaultAt();
  }

  setAt(sessionId: string, atRaw: string): void {
    if (!this.opts.store) throw new Error("planner: not configured");
    let at = atRaw.trim();
    if (at && at !== PlannerOff) {
      const { hour, minute } = parsePlannerAt(at);
      at = formatPlannerAt(hour, minute);
    }
    this.opts.store.setPlannerAt(sessionId, at);
  }

  /** Installs the daily planner unless the session opted out. Opt-out returns a null job. */
  ensureFor(delivery: Delivery): { job: Job | null; created: boolean } {
    if (!this.opts.store) throw new Error("planner: not configured");
    const at = this.resolvedAt(delivery.sessionId);
    if (!at.trim() || at === PlannerOff) {
      this.opts.store.cancelDailyPlanner(delivery.sessionId);
      return { job: null, created: false };
    }
    const loc = zoneOrUtc(this.opts.zone);
    const parsed = parsePlannerSchedule(at, loc, this.opts.store.clock.now());
    const prompt = (this.opts.prompt ?? "").trim() || DefaultDailyPlannerPrompt;
    return this.opts.store.ensureDailyPlanner(prompt, parsed, delivery);
  }
}

export function isDailyPlannerTurn(userText: string): boolean {
  return userText.trim().startsWith(DailyPlannerMarker);
}
