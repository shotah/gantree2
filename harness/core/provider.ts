/**
 * One OpenAI-compatible chat completions endpoint. Ported from
 * `harness/internal/provider`: same message, tool, and result shapes so the
 * agent loop and the eval fixtures carry over.
 */
import type { JsonSchema } from "./tools";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export type ToolCall = {
  id: string;
  name: string;
  /** JSON object text, exactly as the model produced it. */
  arguments: string;
  /**
   * Original `tool_call` JSON when the provider adds fields that must be
   * echoed back (Gemini `extra_content.google.thought_signature`).
   */
  raw?: unknown;
};

export type Message = {
  role: MessageRole;
  content: string;
  /** `user` vision parts: https or `data:image/…;base64,…`. */
  imageUrls?: string[];
  /** `tool` role. */
  toolCallId?: string;
  /** `assistant` role: calls the model requested. */
  toolCalls?: ToolCall[];
};

export type ProviderToolDef = {
  name: string;
  description: string;
  parameters: JsonSchema;
};

export type ChatRequest = {
  messages: Message[];
  tools?: ProviderToolDef[];
  /**
   * Constrain the reply to exactly one tool call named here, via the
   * provider's structured-output grammar. Keep `tools` populated too.
   */
  forceToolNames?: string[];
  signal?: AbortSignal;
};

export type Usage = {
  prompt: number;
  completion: number;
  /**
   * Extra OpenAI-compat counters. Omitted when the provider sent no usage
   * object; a present object may still leave a counter at 0.
   */
  total?: number;
  cached?: number;
  cacheWrite?: number;
  reasoning?: number;
  promptAudio?: number;
  completionAudio?: number;
  acceptedPrediction?: number;
  rejectedPrediction?: number;
};

export type ChatResult = {
  content: string;
  /** Chain-of-thought when the provider emits it. */
  thinking?: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  model?: string;
  serviceTier?: string;
  /** Zero means the provider omitted it. */
  usage: Usage;
};

/** Streaming callback: cumulative text so far, not deltas (what `draft` frames carry). */
export type Progress = (content: string, thinking: string) => void;

export type ChatProvider = {
  complete(req: ChatRequest): Promise<ChatResult>;
  completeStream(req: ChatRequest, onProgress: Progress): Promise<ChatResult>;
};

export type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 0 = omit. */
  maxTokens?: number;
  /** e.g. `none` for Ollama/Qwen no-think; empty = omit. */
  reasoningEffort?: string;
  /** `auto` | `one` | `many` — how system messages fold for providers that allow one. */
  systemFold?: "auto" | "one" | "many";
  timeoutMs?: number;
};
