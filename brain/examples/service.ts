import type { Store } from "@/brain/cron/store";
import { parseSpreadSchedule } from "@/brain/cron/spread";
import { KindExamples } from "@/brain/cron/constants";
import { zoneOrUtc, pad2 } from "@/brain/cron/time";
import type { Delivery, Job } from "@/brain/cron/types";
import { pick, polishPrompt, type NamedTool, type Seed } from "./seeds";

/** Stored on the examples planner and ping rows. Fire-time text comes from `buildPingPrompt`. */
export const plannerPrompt = "capability example ping";

export type ExamplesOptions = {
  store: Store | null;
  /** `EXAMPLES_QTY`. Empty or `"0"` disables proactive ensure. */
  qty: string;
  startHour: number;
  endHour: number;
  zone: string;
  /** Live catalog. Null means harness builtins only. */
  tools?: () => NamedTool[];
};

export class ExamplesService {
  constructor(private readonly opts: ExamplesOptions) {}

  proactiveEnabled(): boolean {
    const q = this.opts.qty.trim();
    return q !== "" && q !== "0";
  }

  suggestPrompt(): { prompt: string; seed: Seed } | null {
    const seed = pick(this.toolDefs());
    if (!seed) return null;
    return { prompt: polishPrompt(seed), seed };
  }

  /** Cron runner body for an `examples_ping`. No-match asks for `[silent]`. */
  buildPingPrompt(): string {
    const hit = this.suggestPrompt();
    if (!hit) return "No multi-step recipes match the connected tools. Reply with exactly [silent].";
    return hit.prompt;
  }

  setEnabled(sessionId: string, on: boolean): void {
    if (!this.opts.store) throw new Error("examples: not configured");
    this.opts.store.setExamplesEnabled(sessionId, on);
    if (!on) this.opts.store.cancelExamplesPlannerAndPings(sessionId);
  }

  /**
   * Seeds the examples planner when proactive config and the session pref allow.
   * Opt-out returns a null job.
   */
  ensureFor(delivery: Delivery): { job: Job | null; created: boolean } {
    if (!this.opts.store) throw new Error("examples: not configured");
    if (!this.proactiveEnabled()) return { job: null, created: false };
    if (!this.opts.store.examplesEnabled(delivery.sessionId)) return { job: null, created: false };
    const loc = zoneOrUtc(this.opts.zone);
    const when = `${this.opts.qty.trim()}@${pad2(this.opts.startHour)}-${pad2(this.opts.endHour)}`;
    const parsed = parseSpreadSchedule(
      KindExamples,
      when,
      this.opts.startHour,
      this.opts.endHour,
      loc,
      this.opts.store.clock.now(),
    );
    return this.opts.store.ensureExamples(plannerPrompt, parsed, delivery);
  }

  private toolDefs(): NamedTool[] | null {
    return this.opts.tools ? this.opts.tools() : null;
  }
}
