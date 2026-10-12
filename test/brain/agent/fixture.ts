import { DatabaseSync } from "node:sqlite";
import { fixedClock, type Clock } from "@/brain/core/clock";
import { makeLogger, memorySink, type Logger } from "@/brain/core/log";
import { nodeSql, type NodeDatabase, type Sql } from "@/brain/core/sql";
import type { ChatProvider, ChatRequest, ChatResult, Usage } from "@/brain/core/provider";
import type { Plugin, TokenStore } from "@/brain/core/tools";
import { textResult } from "@/brain/core/tools";
import type { BrainDeps } from "@/brain/core/brain";
import type { BrainFrame, Emit } from "@/brain/core/wire";

const ZERO: Usage = { prompt: 3, completion: 5 };

export function freshSql(): Sql {
  return nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase);
}

export function scriptResult(partial: Partial<ChatResult> & Pick<ChatResult, "content" | "toolCalls">): ChatResult {
  return {
    content: partial.content,
    toolCalls: partial.toolCalls,
    thinking: partial.thinking,
    finishReason: partial.finishReason,
    model: partial.model ?? "test-model",
    usage: partial.usage ?? ZERO,
  };
}

export class Scripted implements ChatProvider {
  readonly requests: ChatRequest[] = [];
  constructor(private readonly script: ChatResult[]) {}

  complete(req: ChatRequest): Promise<ChatResult> {
    this.requests.push(req);
    const next = this.script.shift();
    if (!next) return Promise.reject(new Error("script exhausted"));
    return Promise.resolve(next);
  }

  async completeStream(req: ChatRequest, onProgress: (content: string, thinking: string) => void): Promise<ChatResult> {
    const result = await this.complete(req);
    if (result.content !== "") onProgress(result.content, result.thinking ?? "");
    return result;
  }
}

export function echoPlugin(name: string, tools: { name: string; text: string }[]): Plugin {
  return {
    name,
    ready: () => Promise.resolve(null),
    tools: () => tools.map((tool) => ({
      name: tool.name,
      description: tool.name,
      inputSchema: { type: "object", properties: {} },
      call: () => Promise.resolve(textResult(tool.text)),
    })),
  };
}

export function tokens(): TokenStore {
  return {
    get: () => Promise.resolve(null),
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  };
}

export function testDeps(extra: {
  sql?: Sql;
  clock?: Clock;
  log?: Logger;
  provider: ChatProvider;
  plugins?: Plugin[];
  env?: Record<string, string>;
  persona?: { name: string; text: string }[];
}): BrainDeps & { sql: Sql; clock: Clock } {
  const clock = extra.clock ?? fixedClock(Date.parse("2026-09-14T19:00:00Z"), "America/Los_Angeles");
  const sql = extra.sql ?? freshSql();
  return {
    sql,
    clock,
    log: extra.log ?? makeLogger(memorySink(), () => clock.now()),
    provider: extra.provider,
    plugins: extra.plugins ?? [],
    tokens: tokens(),
    fetch: globalThis.fetch.bind(globalThis),
    env: {
      MEMORY_CONSOLIDATE_MINUTES: "0",
      EXAMPLES_QTY: "0",
      DYNAMIC_TOOLS: "0",
      LLM_MODEL: "test-model",
      ...extra.env,
    },
    persona: extra.persona ?? [],
    slug: "ada",
  };
}

export function collect(): { emit: Emit; frames: BrainFrame[] } {
  const frames: BrainFrame[] = [];
  const emit: Emit = (frame) => {
    frames.push(frame);
  };
  return { emit, frames };
}
