/**
 * What one turn asked the model to do, and which of those calls actually
 * ran. Plugin tools count only when the canned plugin's `call` runs — a
 * prefix the loop blocked never reaches it, and that miss is a real miss.
 * Unprefixed builtins (`mcp_enable`, `cron_schedule`, `memory_store`,
 * `aim_log`) count when the model requested them: the loop does not
 * filter those. Rounds and token totals come from the wrapped provider.
 */
import type { ChatProvider, ChatRequest, ChatResult, Message } from "@/brain/core/provider";
import type { EvalCall } from "./expect";

type Slot = {
  id: string;
  name: string;
  args: string;
  round: number;
  executed: boolean;
  result: string;
};

export type TraceMark = {
  slots: number;
  extras: number;
  round: number;
  prompt: number;
  completion: number;
};

export type TraceSlice = {
  calls: EvalCall[];
  rounds: number;
  prompt: number;
  completion: number;
};

export class Trace {
  round = 0;
  prompt = 0;
  completion = 0;
  private slots: Slot[] = [];
  private extras: EvalCall[] = [];

  mark(): TraceMark {
    return {
      slots: this.slots.length,
      extras: this.extras.length,
      round: this.round,
      prompt: this.prompt,
      completion: this.completion,
    };
  }

  /** Calls and usage since `mark`, with rounds renumbered from 1. */
  since(mark: TraceMark): TraceSlice {
    const calls: EvalCall[] = [];
    for (const slot of this.slots.slice(mark.slots)) {
      if (!slot.executed) {
        continue;
      }
      calls.push({
        name: slot.name,
        args: slot.args,
        round: slot.round - mark.round,
        result: slot.result,
      });
    }
    for (const extra of this.extras.slice(mark.extras)) {
      calls.push({ ...extra, round: extra.round - mark.round });
    }
    return {
      calls,
      rounds: this.round - mark.round,
      prompt: this.prompt - mark.prompt,
      completion: this.completion - mark.completion,
    };
  }

  /**
   * A canned plugin ran. Confirms the model call from this round when
   * there is one; otherwise records the call on its own (the loop invoked
   * a tool the wrapper did not see).
   */
  confirmPlugin(name: string, args: Record<string, unknown>, result: string): void {
    const slot = this.slots.find((item) => item.name === name && !item.executed && item.round === this.round)
      ?? this.slots.find((item) => item.name === name && !item.executed);
    if (slot) {
      slot.executed = true;
      slot.result = result;
      return;
    }
    this.extras.push({
      name,
      args: JSON.stringify(args),
      round: this.round > 0 ? this.round : 1,
      result,
    });
  }

  wrap(inner: ChatProvider): ChatProvider {
    return {
      complete: async (req) => this.observe(req, () => inner.complete(req)),
      completeStream: async (req, onProgress) => this.observe(req, () => inner.completeStream(req, onProgress)),
    };
  }

  private async observe(req: ChatRequest, run: () => Promise<ChatResult>): Promise<ChatResult> {
    this.absorb(req.messages);
    this.round += 1;
    const result = await run();
    this.prompt += result.usage.prompt;
    this.completion += result.usage.completion;
    for (const call of result.toolCalls) {
      const plugin = call.name.includes("__");
      this.slots.push({
        id: call.id,
        name: call.name,
        args: call.arguments,
        round: this.round,
        executed: !plugin,
        result: "",
      });
    }
    return result;
  }

  private absorb(messages: readonly Message[]): void {
    for (const message of messages) {
      if (message.role !== "tool" || !message.toolCallId) {
        continue;
      }
      const slot = this.slots.find((item) => item.id === message.toolCallId);
      if (slot && slot.result === "") {
        slot.result = message.content;
      }
    }
  }
}
