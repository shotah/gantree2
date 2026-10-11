import OpenAI, { APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import type { ChatProvider, ChatRequest, ChatResult, Message, Progress, ProviderConfig, ProviderToolDef, ToolCall } from "@/brain/core/provider";
import { ProviderError } from "./errors";
import { wireMessagesMode } from "./messages";
import { StreamToolBuf, mergeName } from "./stream";
import { parseToolCallText } from "./toolcalltext";
import { usageFrom } from "./usage";

/** Google's escape hatch when a thought signature was not preserved. */
const SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator";

/** Provider error bodies are a few hundred bytes; clip a stray HTML page. */
const API_ERROR_BODY_MAX = 800;

/**
 * `setTimeout` cannot wait longer than this. Used when `timeoutMs` is unset so
 * the SDK's 10-minute default does not cut off a local model. Real deadlines
 * are an `AbortSignal`.
 */
const NO_TIMEOUT_MS = 2_147_483_647;

const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  408: "Request Timeout",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

/** Callback threw; do not rewrap it as an HTTP failure. */
class ProgressHalt extends Error {
  constructor(readonly reason: unknown) {
    super("progress");
    this.name = "ProgressHalt";
  }
}

/**
 * One OpenAI-compatible chat completions client. `fetchImpl` is the Workers
 * `fetch` (or a test double); the `openai` SDK parses SSE.
 */
export function openaiProvider(config: ProviderConfig, fetchImpl?: typeof fetch): ChatProvider {
  const maxTokens = config.maxTokens !== undefined && config.maxTokens > 0 ? Math.floor(config.maxTokens) : 0;
  const reasoningEffort = (config.reasoningEffort ?? "").trim();
  const systemFold = (config.systemFold ?? "").trim().toLowerCase();
  const timeoutMs = config.timeoutMs !== undefined && config.timeoutMs > 0 ? Math.floor(config.timeoutMs) : 0;
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    maxRetries: 0,
    logLevel: "off",
    timeout: NO_TIMEOUT_MS,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });

  function requestOptions(caller?: AbortSignal, timed?: AbortSignal): OpenAI.RequestOptions {
    const signal = caller && timed ? AbortSignal.any([caller, timed]) : caller ?? timed;
    const options: OpenAI.RequestOptions = {};
    if (signal) {
      options.signal = signal;
    }
    if (timeoutMs > 0) {
      options.timeout = timeoutMs;
    }
    return options;
  }

  function buildBody(req: ChatRequest, stream: boolean): Record<string, unknown> {
    const messages = wireMessagesMode(systemFold, config.model, req.messages).map(toParam);
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
    };
    // Ollama and Gemini's compat layer still read max_tokens. The SDK marks
    // that field deprecated in favor of max_completion_tokens, which they ignore.
    if (maxTokens > 0) {
      body.max_tokens = maxTokens;
    }
    if (reasoningEffort !== "") {
      body.reasoning_effort = reasoningEffort;
    }
    const tools = toTools(req.tools ?? []);
    if (tools.length > 0) {
      body.tools = tools;
    }
    const force = req.forceToolNames ?? [];
    if (force.length > 0) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: "tool_call",
          strict: true,
          schema: forcedToolCallSchema(force),
        },
      };
    }
    if (stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }
    return body;
  }

  async function complete(req: ChatRequest): Promise<ChatResult> {
    if (req.messages.length === 0) {
      throw new ProviderError("request", "provider: messages must not be empty");
    }
    const timed = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    try {
      const resp = await client.chat.completions.create(
        buildBody(req, false) as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming,
        requestOptions(req.signal, timed),
      );
      return fromCompletion(resp, req.forceToolNames ?? []);
    } catch (err) {
      fail(err, "completion", req.signal, timed);
    }
  }

  async function completeStream(req: ChatRequest, onProgress: Progress): Promise<ChatResult> {
    if (req.messages.length === 0) {
      throw new ProviderError("request", "provider: messages must not be empty");
    }
    // A grammar-constrained reply is JSON, not prose. Streaming it would type
    // raw JSON into the user's bubble.
    if ((req.forceToolNames?.length ?? 0) > 0) {
      return complete(req);
    }
    const timed = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
    try {
      const stream = await client.chat.completions.create(
        buildBody(req, true) as unknown as OpenAI.ChatCompletionCreateParamsStreaming,
        requestOptions(req.signal, timed),
      );
      return await consumeStream(stream, onProgress);
    } catch (err) {
      if (err instanceof ProgressHalt) {
        throw asThrown(err.reason);
      }
      fail(err, "stream", req.signal, timed);
    }
  }

  return { complete, completeStream };
}

function toTools(tools: ProviderToolDef[]): OpenAI.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function forcedToolCallSchema(names: string[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      name: { type: "string", enum: names },
      arguments: { type: "object" },
    },
    required: ["name", "arguments"],
    additionalProperties: false,
  };
}

function toParam(message: Message): OpenAI.ChatCompletionMessageParam {
  const role = message.role as string;
  switch (role) {
    case "system":
      return { role: "system", content: message.content };
    case "user":
      return userParam(message);
    case "assistant":
      return assistantParam(message);
    case "tool":
      if (!message.toolCallId) {
        throw new ProviderError("request", "provider: tool message missing tool_call_id");
      }
      return { role: "tool", content: message.content, tool_call_id: message.toolCallId };
    default:
      throw new ProviderError("request", `provider: unknown role ${JSON.stringify(role)}`);
  }
}

function userParam(message: Message): OpenAI.ChatCompletionMessageParam {
  const urls = message.imageUrls ?? [];
  if (urls.length === 0) {
    return { role: "user", content: message.content };
  }
  const text = message.content === "" ? "[photo]" : message.content;
  const parts: OpenAI.ChatCompletionContentPart[] = [{ type: "text", text }];
  for (const raw of urls) {
    const url = raw.trim();
    if (url === "") {
      continue;
    }
    parts.push({ type: "image_url", image_url: { url } });
  }
  return { role: "user", content: parts };
}

function assistantParam(message: Message): OpenAI.ChatCompletionMessageParam {
  const calls = message.toolCalls ?? [];
  if (calls.length === 0) {
    return { role: "assistant", content: message.content };
  }
  return {
    role: "assistant",
    ...(message.content !== "" ? { content: message.content } : {}),
    tool_calls: calls.map(toolCallPayload) as OpenAI.ChatCompletionMessageToolCall[],
  };
}

function toolCallPayload(call: ToolCall): unknown {
  const raw = call.raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new ProviderError("request", `provider: encode tool call: ${detail}`, { cause: err });
    }
  }
  if (raw && typeof raw === "object") {
    return raw;
  }
  return synthesizeToolCallRaw(call);
}

function synthesizeToolCallRaw(call: ToolCall): Record<string, unknown> {
  return {
    id: call.id,
    type: "function",
    function: {
      name: call.name,
      arguments: call.arguments.trim() === "" ? "{}" : call.arguments,
    },
    extra_content: {
      google: { thought_signature: SKIP_THOUGHT_SIGNATURE },
    },
  };
}

function fromCompletion(resp: OpenAI.ChatCompletion, forceNames: string[]): ChatResult {
  const choice = resp.choices[0];
  if (!choice) {
    throw new ProviderError("http", "provider: empty choices in response");
  }
  const message = choice.message;
  let content = (message.content ?? "").trim();
  const thinking = extractThinking(message).trim();
  const toolCalls: ToolCall[] = [];
  for (const call of message.tool_calls ?? []) {
    if (call.type !== "function") {
      continue;
    }
    toolCalls.push({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
      raw: call,
    });
  }
  let finish = choice.finish_reason || "";
  if (toolCalls.length === 0 && forceNames.length > 0) {
    const parsed = parseToolCallText(content);
    if (parsed) {
      toolCalls.push(parsed);
      content = "";
      finish = "tool_calls";
    }
  }
  if (content === "" && toolCalls.length === 0 && thinking === "") {
    throw emptyContent(finish);
  }
  return resultOf({
    content,
    thinking,
    toolCalls,
    finish,
    model: resp.model,
    serviceTier: resp.service_tier ?? "",
    usageRaw: resp.usage,
  });
}

async function consumeStream(stream: AsyncIterable<OpenAI.ChatCompletionChunk>, onProgress: Progress): Promise<ChatResult> {
  let full = "";
  let thinking = "";
  let sawTool = false;
  let finish = "";
  let model = "";
  let serviceTier = "";
  let usageRaw: unknown;
  const tools = new StreamToolBuf();

  for await (const chunk of stream) {
    if (chunk.model) {
      model = chunk.model;
    }
    if (typeof chunk.service_tier === "string") {
      serviceTier = chunk.service_tier;
    }
    if (chunk.usage && typeof chunk.usage === "object") {
      usageRaw = chunk.usage;
    }
    const choice = chunk.choices[0];
    if (!choice) {
      continue;
    }
    if (choice.finish_reason) {
      finish = choice.finish_reason;
    }
    const delta = choice.delta;
    const deltas = delta.tool_calls ?? [];
    if (deltas.length > 0) {
      sawTool = true;
      for (const call of deltas) {
        const index = typeof call.index === "number" ? call.index : 0;
        const acc = tools.accFor(index, call.id ?? "");
        mergeName(acc, call.function?.name ?? "");
        acc.args += call.function?.arguments ?? "";
      }
    }
    let changed = false;
    const thought = extractThinking(delta);
    if (thought !== "") {
      thinking += thought;
      changed = true;
    }
    if (typeof delta.content === "string" && delta.content !== "") {
      full += delta.content;
      changed = true;
    }
    if (changed && !sawTool) {
      try {
        onProgress(full, thinking);
      } catch (err) {
        throw new ProgressHalt(err);
      }
    }
  }

  const toolCalls: ToolCall[] = [];
  for (const acc of tools.order) {
    if (acc.name === "" && acc.id === "") {
      continue;
    }
    const call: ToolCall = { id: acc.id, name: acc.name, arguments: acc.args };
    call.raw = synthesizeToolCallRaw(call);
    toolCalls.push(call);
  }
  const content = full.trim();
  const thought = thinking.trim();
  if (content === "" && toolCalls.length === 0 && thought === "") {
    throw emptyContent(finish);
  }
  return resultOf({
    content,
    thinking: thought,
    toolCalls,
    finish,
    model,
    serviceTier,
    usageRaw,
  });
}

function resultOf(parts: {
  content: string;
  thinking: string;
  toolCalls: ToolCall[];
  finish: string;
  model: string;
  serviceTier: string;
  usageRaw: unknown;
}): ChatResult {
  return {
    content: parts.content,
    ...(parts.thinking !== "" ? { thinking: parts.thinking } : {}),
    toolCalls: parts.toolCalls,
    ...(parts.finish !== "" ? { finishReason: parts.finish } : {}),
    ...(parts.model !== "" ? { model: parts.model } : {}),
    ...(parts.serviceTier !== "" ? { serviceTier: parts.serviceTier } : {}),
    usage: usageFrom(parts.usageRaw),
  };
}

function emptyContent(finish: string): ProviderError {
  return new ProviderError("empty", `provider: empty assistant content (finish_reason=${JSON.stringify(finish)})`);
}

/** Ollama/DeepSeek reasoning fields are not on the typed message or delta. */
function extractThinking(value: object): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return "";
  }
  const rec = record(parsed);
  if (!rec) {
    return "";
  }
  for (const key of ["reasoning", "reasoning_content", "thinking"]) {
    const field = rec[key];
    if (typeof field === "string" && field !== "") {
      return field;
    }
  }
  return "";
}

function fail(err: unknown, via: "completion" | "stream", caller?: AbortSignal, timed?: AbortSignal): never {
  if (err instanceof ProviderError) {
    throw err;
  }
  const abort = classifyAbort(err, caller, timed);
  if (abort === "timeout") {
    throw new ProviderError("timeout", "provider: timeout", { cause: err });
  }
  if (abort === "aborted") {
    throw new ProviderError("aborted", "provider: aborted", { cause: err });
  }
  if (err instanceof APIError && typeof err.status === "number") {
    const detail = diagnostic(err.status, err.message, err.error);
    const kind = classifyKind(err.status, err.code, err.type, detail);
    throw new ProviderError(kind, messageFor(kind, via, detail), { status: err.status, cause: err });
  }
  const message = err instanceof Error ? err.message : String(err);
  const channel = via === "stream" ? "provider: chat stream" : "provider: chat completion";
  throw new ProviderError("http", `${channel}: ${message}`, { cause: err });
}

function asThrown(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  return new ProviderError("request", String(reason));
}

function classifyAbort(err: unknown, caller?: AbortSignal, timed?: AbortSignal): "timeout" | "aborted" | undefined {
  if (caller?.aborted) {
    return "aborted";
  }
  if (timed?.aborted || err instanceof APIConnectionTimeoutError || named(err, "TimeoutError")) {
    return "timeout";
  }
  if (err instanceof APIUserAbortError || named(err, "AbortError")) {
    return "aborted";
  }
  return undefined;
}

function named(err: unknown, name: string): boolean {
  return err instanceof Error && err.name === name;
}

function classifyKind(status: number, code: string | null | undefined, type: string | undefined, text: string): "rate_limit" | "context_length" | "auth" | "http" {
  const hay = `${code ?? ""} ${type ?? ""} ${text}`.toLowerCase();
  if (status === 429 || hay.includes("rate_limit") || hay.includes("rate limit") || hay.includes("too many requests")) {
    return "rate_limit";
  }
  if (hay.includes("context_length") || hay.includes("context length") || hay.includes("maximum context") || hay.includes("context window")) {
    return "context_length";
  }
  if (
    status === 401
    || status === 403
    || code === "invalid_api_key"
    || hay.includes("invalid api key")
    || hay.includes("incorrect api key")
    || hay.includes("authentication")
    || type === "authentication_error"
  ) {
    return "auth";
  }
  return "http";
}

function messageFor(kind: "rate_limit" | "context_length" | "auth" | "http", via: "completion" | "stream", detail: string): string {
  if (kind === "rate_limit") {
    return `provider: rate limit: ${detail}`;
  }
  if (kind === "context_length") {
    return `provider: context length exceeded: ${detail}`;
  }
  if (kind === "auth") {
    return `provider: authentication failed: ${detail}`;
  }
  const channel = via === "stream" ? "provider: chat stream" : "provider: chat completion";
  return `${channel}: ${detail}`;
}

/**
 * Object-shaped `{error:{message}}` bodies already ride in the SDK message.
 * Gemini answers some 400s with a JSON array, which the SDK does not lift, so
 * put that body back on the error (clipped).
 */
function diagnostic(status: number, message: string, error: unknown): string {
  if (isLifted(error)) {
    return message;
  }
  const text = STATUS_TEXT[status] ?? "";
  const head = text ? `${status} ${text}` : String(status);
  const body = clip(unliftedBody(status, message, error), API_ERROR_BODY_MAX);
  if (body === "") {
    return head;
  }
  return `${head} body: ${body}`;
}

function isLifted(error: unknown): boolean {
  const rec = record(error);
  return typeof rec?.message === "string" && rec.message !== "";
}

function unliftedBody(status: number, message: string, error: unknown): string {
  if (Array.isArray(error) || record(error)) {
    return JSON.stringify(error);
  }
  const prefix = `${status} `;
  if (message.startsWith(prefix)) {
    return message.slice(prefix.length);
  }
  return message;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}
