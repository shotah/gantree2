import type { ToolDef } from "@/harness/core/tools";
import { isCronTool, cronToolDefs, type CronTools } from "./tools";
import type { Delivery } from "./types";

export type ToolRunner = {
  tools(): ToolDef[];
  call(name: string, args: Record<string, unknown> | null): Promise<string> | string;
};

/** Builtin cron tools first, then an optional other runner. */
export class Composite {
  constructor(
    readonly cron: CronTools,
    readonly other: ToolRunner | null = null,
  ) {}

  tools(): ToolDef[] {
    const defs = cronToolDefs();
    if (!this.other) return defs;
    return [...defs, ...this.other.tools()];
  }

  toolCount(): number {
    return this.tools().length;
  }

  async call(name: string, args: Record<string, unknown> | null, delivery?: Delivery): Promise<string> {
    if (isCronTool(name)) return this.cron.call(name, args, delivery);
    if (!this.other) throw new Error(`cron: no tool runner for ${JSON.stringify(name)}`);
    return this.other.call(name, args);
  }
}
