import { describe, expect, it } from "vitest";
import type { ChatRequest, ProviderConfig } from "@/brain/core/provider";
import { addUsage, isEmptyContent, openaiProvider, usagePresent, type ProviderError } from "@/brain/provider";

const hi: ChatRequest = { messages: [{ role: "user", content: "hi" }] };

function mockFetch(handle: (req: Request, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  const impl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "POST";
    const headers = new Headers(init?.headers);
    let body: string | undefined;
    if (typeof init?.body === "string") {
      body = init.body;
    } else if (init?.body instanceof Uint8Array) {
      body = new TextDecoder().decode(init.body);
    }
    const req = new Request(url, { method, headers, body });
    return handle(req, init);
  };
  return impl;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sse(chunks: string[]): Response {
  const payload = `${chunks.map((chunk) => `data: ${chunk}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(payload, { headers: { "content-type": "text/event-stream" } });
}

function reply(content: string): Response {
  return json({
    id: "chatcmpl-test",
    choices: [{ index: 0, message: { role: "assistant", content } }],
  });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await req.text());
  const body = obj(parsed);
  if (!body) {
    throw new Error("body is not an object");
  }
  return body;
}

function obj(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function messagesOf(body: Record<string, unknown>): Record<string, unknown>[] {
  return arr(body.messages).flatMap((item) => {
    const message = obj(item);
    return message ? [message] : [];
  });
}

function thoughtSignature(call: unknown): unknown {
  const google = obj(obj(obj(call)?.extra_content)?.google);
  return google?.thought_signature;
}

function nameEnum(body: Record<string, unknown>): unknown[] {
  const schema = obj(obj(obj(body.response_format)?.json_schema)?.schema);
  const name = obj(obj(schema?.properties)?.name);
  return arr(name?.enum);
}

function client(fetchImpl: typeof fetch, config: Partial<ProviderConfig> = {}) {
  return openaiProvider({
    baseUrl: "http://llm.test/v1",
    apiKey: "test-key",
    model: "test-model",
    ...config,
  }, fetchImpl);
}

describe("openaiProvider complete", () => {
  it("trims content, sends the key, and omits max_tokens and usage", async () => {
    const fetchImpl = mockFetch(async (req) => {
      expect(new URL(req.url).pathname.endsWith("/chat/completions")).toBe(true);
      expect(req.headers.get("authorization")).toContain("test-key");
      const body = await readBody(req);
      expect(body.model).toBe("test-model");
      expect(body.max_tokens).toBeUndefined();
      return json({
        id: "chatcmpl-test",
        choices: [{ index: 0, message: { role: "assistant", content: "  hello there  " } }],
      });
    });
    const got = await client(fetchImpl).complete({
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "prior" },
      ],
    });
    expect(got.content).toBe("hello there");
    expect(usagePresent(got.usage)).toBe(false);
  });

  it("sends max_tokens when set", async () => {
    const fetchImpl = mockFetch(async (req) => {
      const body = await readBody(req);
      expect(body.max_tokens).toBe(256);
      return reply("ok");
    });
    await client(fetchImpl, { maxTokens: 256, apiKey: "k", model: "m" }).complete(hi);
  });

  it("sends reasoning_effort when set", async () => {
    const fetchImpl = mockFetch(async (req) => {
      const body = await readBody(req);
      expect(body.reasoning_effort).toBe("none");
      return reply("ok");
    });
    await client(fetchImpl, { reasoningEffort: "none", apiKey: "k", model: "m" }).complete(hi);
  });

  it("returns a function tool call and sends the tool list", async () => {
    const fetchImpl = mockFetch(async (req) => {
      const body = await readBody(req);
      expect(body.tools).toBeDefined();
      return json({
        id: "chatcmpl-tools",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "demo__echo", arguments: "{\"text\":\"hi\"}" },
            }],
          },
        }],
      });
    });
    const got = await client(fetchImpl, { apiKey: "k", model: "m" }).complete({
      messages: [{ role: "user", content: "echo" }],
      tools: [{ name: "demo__echo", description: "echo", parameters: { type: "object" } }],
    });
    expect(got.toolCalls).toHaveLength(1);
    expect(got.toolCalls[0]?.name).toBe("demo__echo");
  });

  it("captures thinking and a thought signature on a non-stream reply", async () => {
    const fetchImpl = mockFetch(() => json({
      id: "chatcmpl-think",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: "hi",
          reasoning: "because",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "demo__echo", arguments: "{}" },
            extra_content: { google: { thought_signature: "sig-from-model" } },
          }],
        },
      }],
    }));
    const got = await client(fetchImpl, { apiKey: "k", model: "m" }).complete({
      messages: [{ role: "user", content: "echo" }],
      tools: [{ name: "demo__echo", description: "echo", parameters: { type: "object" } }],
    });
    expect(got.thinking).toBe("because");
    expect(got.content).toBe("hi");
    expect(thoughtSignature(got.toolCalls[0]?.raw)).toBe("sig-from-model");
  });

  it("rejects an empty message list before calling fetch", async () => {
    const fetchImpl = mockFetch(() => {
      throw new Error("fetch should not run");
    });
    await expect(client(fetchImpl, { baseUrl: "http://example.invalid", apiKey: "k", model: "m" }).complete({ messages: [] }))
      .rejects.toThrow(/messages must not be empty/);
  });

  it("rejects an unknown role", async () => {
    const fetchImpl = mockFetch(() => {
      throw new Error("fetch should not run");
    });
    const bad = { messages: [{ role: "nope", content: "x" }] } as unknown as ChatRequest;
    await expect(client(fetchImpl, { baseUrl: "http://example.invalid", apiKey: "k", model: "m" }).complete(bad))
      .rejects.toThrow(/unknown role/);
  });

  it("rejects an empty choices array", async () => {
    const fetchImpl = mockFetch(() => json({ id: "chatcmpl-test", choices: [] }));
    await expect(client(fetchImpl, { apiKey: "k", model: "m" }).complete(hi)).rejects.toThrow(/empty choices/);
  });

  it("rejects whitespace-only content as empty", async () => {
    const fetchImpl = mockFetch(() => json({
      id: "chatcmpl-test",
      choices: [{ index: 0, message: { role: "assistant", content: "   " } }],
    }));
    await expect(client(fetchImpl, { apiKey: "k", model: "m" }).complete(hi)).rejects.toSatisfy(isEmptyContent);
  });

  it("surfaces an HTTP failure", async () => {
    const fetchImpl = mockFetch(() => new Response("nope\n", { status: 502, headers: { "content-type": "text/plain" } }));
    await expect(client(fetchImpl, { apiKey: "k", model: "m" }).complete(hi)).rejects.toThrow();
  });

  it("echoes a synthesized thought signature on a tool round trip", async () => {
    const fetchImpl = mockFetch(async (req) => {
      const body = await readBody(req);
      let foundTool = false;
      let sawSkip = false;
      for (const message of messagesOf(body)) {
        if (message.role === "tool") {
          foundTool = true;
        }
        if (message.role === "assistant") {
          for (const call of arr(message.tool_calls)) {
            if (thoughtSignature(call) === "skip_thought_signature_validator") {
              sawSkip = true;
            }
          }
        }
      }
      expect(foundTool).toBe(true);
      expect(sawSkip).toBe(true);
      return reply("done");
    });
    const got = await client(fetchImpl, { apiKey: "k", model: "m" }).complete({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", toolCalls: [{ id: "c1", name: "demo__echo", arguments: "{}" }], content: "" },
        { role: "tool", content: "ok", toolCallId: "c1" },
      ],
    });
    expect(got.content).toBe("done");
  });

  it("echoes a captured thought signature verbatim", async () => {
    const raw = {
      id: "c1",
      type: "function",
      function: { name: "demo__echo", arguments: "{}" },
      extra_content: { google: { thought_signature: "sig-from-model" } },
    };
    const fetchImpl = mockFetch(async (req) => {
      const body = await readBody(req);
      for (const message of messagesOf(body)) {
        if (message.role !== "assistant") {
          continue;
        }
        const calls = arr(message.tool_calls);
        expect(calls.length).toBeGreaterThan(0);
        expect(thoughtSignature(calls[0])).toBe("sig-from-model");
      }
      return reply("ok");
    });
    await client(fetchImpl, { apiKey: "k", model: "m" }).complete({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "demo__echo", arguments: "{}", raw }] },
        { role: "tool", content: "ok", toolCallId: "c1" },
      ],
    });
  });

  it("copies model, finish reason, service tier, and usage details", async () => {
    const fetchImpl = mockFetch(() => json({
      id: "chatcmpl-u",
      model: "gpt-test",
      service_tier: "flex",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "hello" } }],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 4,
        total_tokens: 16,
        prompt_tokens_details: { cached_tokens: 8, audio_tokens: 1 },
        completion_tokens_details: {
          reasoning_tokens: 2,
          audio_tokens: 1,
          accepted_prediction_tokens: 3,
          rejected_prediction_tokens: 1,
        },
      },
    }));
    const got = await client(fetchImpl, { apiKey: "k", model: "m" }).complete(hi);
    expect(got.model).toBe("gpt-test");
    expect(got.finishReason).toBe("stop");
    expect(got.serviceTier).toBe("flex");
    const usage = got.usage;
    expect(usagePresent(usage)).toBe(true);
    expect(usage.prompt).toBe(12);
    expect(usage.completion).toBe(4);
    expect(usage.total).toBe(16);
    expect(usage.cached).toBe(8);
    expect(usage.reasoning).toBe(2);
    expect(usage.promptAudio).toBe(1);
    expect(usage.completionAudio).toBe(1);
    expect(usage.acceptedPrediction).toBe(3);
    expect(usage.rejectedPrediction).toBe(1);
  });

  it("folds system messages when asked, even for a non-Gemini model", async () => {
    const fetchImpl = mockFetch(async (req) => {
      const body = await readBody(req);
      const messages = messagesOf(body);
      expect(messages).toHaveLength(2);
      expect(messages[0]?.role).toBe("system");
      expect(String(messages[0]?.content)).toContain("[harness]");
      return reply("ok");
    });
    await client(fetchImpl, { apiKey: "k", model: "gemma4", systemFold: "one" }).complete({
      messages: [
        { role: "system", content: "You are Kit." },
        { role: "user", content: "what's near me" },
        { role: "system", content: "[harness]\n[current time] NOW" },
      ],
    });
  });

  it("folds Gemini down to one system message", async () => {
    const fetchImpl = mockFetch(async (req) => {
      const body = await readBody(req);
      const messages = messagesOf(body);
      const systems = messages.filter((message) => message.role === "system");
      expect(systems).toHaveLength(1);
      expect(String(systems[0]?.content)).toContain("[harness]");
      expect(String(systems[0]?.content)).toContain("You are Kit.");
      const last = messages[messages.length - 1];
      expect(last?.role).toBe("user");
      expect(last?.content).toBe("what's near me");
      return reply("ok");
    });
    await client(fetchImpl, { apiKey: "k", model: "gemini-3.6-flash" }).complete({
      messages: [
        { role: "system", content: "You are Kit." },
        { role: "user", content: "what's near me" },
        { role: "system", content: "[harness]\n[current time] NOW" },
      ],
    });
  });

  it("keeps a trailing system message for OpenAI", async () => {
    const fetchImpl = mockFetch(async (req) => {
      const body = await readBody(req);
      const messages = messagesOf(body);
      expect(messages).toHaveLength(3);
      expect(messages[2]?.role).toBe("system");
      expect(String(messages[2]?.content)).toContain("[harness]");
      return reply("ok");
    });
    await client(fetchImpl, { apiKey: "k", model: "gpt-5.4" }).complete({
      messages: [
        { role: "system", content: "You are Kit." },
        { role: "user", content: "what's near me" },
        { role: "system", content: "[harness]\n[current time] NOW" },
      ],
    });
  });

  it("sends user image parts", async () => {
    const fetchImpl = mockFetch(async (req) => {
      const body = await readBody(req);
      const messages = messagesOf(body);
      expect(messages).toHaveLength(1);
      const content = arr(messages[0]?.content);
      expect(content).toHaveLength(2);
      const raw = JSON.stringify(content);
      expect(raw).toContain("image_url");
      expect(raw).toContain("data:image/png;base64,aa");
      return reply("a cat");
    });
    const got = await client(fetchImpl, { apiKey: "k", model: "m" }).complete({
      messages: [{ role: "user", content: "what is this?", imageUrls: ["data:image/png;base64,aa"] }],
    });
    expect(got.content).toBe("a cat");
  });

  it("turns forced-tool JSON content into a tool call", async () => {
    const names = ["garmin__wellness_get_body_battery", "garmin__hrv_get"];
    const fetchImpl = mockFetch(async (req) => {
      const body = await readBody(req);
      expect(nameEnum(body)).toEqual(names);
      expect(obj(body.response_format)?.type).toBe("json_schema");
      expect(body.tools).toBeDefined();
      expect(body.stream).not.toBe(true);
      return json({
        id: "chatcmpl-test",
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "{\"name\":\"garmin__hrv_get\",\"arguments\":{\"date\":\"2026-07-27\"}}",
          },
        }],
      });
    });
    const got = await client(fetchImpl).complete({
      messages: [{ role: "user", content: "hrv yesterday?" }],
      tools: [{ name: "garmin__hrv_get", description: "", parameters: { type: "object" } }],
      forceToolNames: names,
    });
    expect(got.toolCalls).toHaveLength(1);
    expect(got.toolCalls[0]?.name).toBe("garmin__hrv_get");
    expect(got.toolCalls[0]?.arguments).toContain("2026-07-27");
    expect(got.toolCalls[0]?.id).not.toBe("");
    expect(got.content).toBe("");
    expect(got.finishReason).toBe("tool_calls");
  });
});

describe("usage", () => {
  it("treats the zero value as absent and adds field-wise", () => {
    expect(usagePresent({ prompt: 0, completion: 0 })).toBe(false);
    const sum = addUsage(
      { prompt: 10, completion: 2, total: 12, cached: 4 },
      { prompt: 3, completion: 1, total: 4, reasoning: 5 },
    );
    expect(sum.prompt).toBe(13);
    expect(sum.completion).toBe(3);
    expect(sum.total).toBe(16);
    expect(sum.cached).toBe(4);
    expect(sum.reasoning).toBe(5);
    expect(usagePresent(sum)).toBe(true);
  });
});

describe("openaiProvider errors", () => {
  const geminiBody = "[{\"error\":{\"code\":400,\"message\":\"Please ensure that function call turn comes immediately after a user turn or after a function response turn.\",\"status\":\"INVALID_ARGUMENT\"}}]";

  it("puts a non-object error body back on the message", async () => {
    const fetchImpl = mockFetch(() => new Response(geminiBody, { status: 400, headers: { "content-type": "application/json" } }));
    const provider = client(fetchImpl, { apiKey: "k", model: "m" });
    await expect(provider.completeStream(hi, () => undefined)).rejects.toThrow(/400 Bad Request/);
    await expect(provider.completeStream(hi, () => undefined)).rejects.toThrow(/function call turn comes immediately after a user turn/);
    await expect(provider.complete(hi)).rejects.toThrow(/400 Bad Request/);
    await expect(provider.complete(hi)).rejects.toThrow(/INVALID_ARGUMENT/);
  });

  it("does not append an object error body twice", async () => {
    const fetchImpl = mockFetch(() => new Response(
      JSON.stringify({ error: { message: "unknown model zzz", type: "invalid_request_error" } }),
      { status: 400, headers: { "content-type": "application/json" } },
    ));
    try {
      await client(fetchImpl, { apiKey: "k", model: "m" }).complete(hi);
      expect.unreachable();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      expect(message.split("unknown model zzz")).toHaveLength(2);
      expect(message).not.toContain(" body: ");
    }
  });

  it("maps rate limit, context length, and auth onto stable kinds", async () => {
    const cases: { status: number; body: unknown; kind: ProviderError["kind"]; phrase: string }[] = [
      {
        status: 429,
        body: { error: { message: "Rate limit reached", type: "rate_limit_error", code: "rate_limit_exceeded" } },
        kind: "rate_limit",
        phrase: "provider: rate limit",
      },
      {
        status: 400,
        body: { error: { message: "This model's maximum context length is 8192 tokens.", type: "invalid_request_error", code: "context_length_exceeded" } },
        kind: "context_length",
        phrase: "provider: context length exceeded",
      },
      {
        status: 401,
        body: { error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } },
        kind: "auth",
        phrase: "provider: authentication failed",
      },
    ];
    for (const tc of cases) {
      const fetchImpl = mockFetch(() => json(tc.body, tc.status));
      const err = await client(fetchImpl, { apiKey: "k", model: "m" }).complete(hi).then(() => {
        throw new Error("expected failure");
      }, (caught: unknown) => caught);
      expect(err, tc.kind).toMatchObject({ kind: tc.kind });
      expect(err instanceof Error ? err.message : "").toContain(tc.phrase);
    }
  });

  it("times out through AbortSignal", async () => {
    const fetchImpl: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("missing signal"));
        return;
      }
      const onAbort = () => {
        reject(signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError"));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const err = await client(fetchImpl, { apiKey: "k", model: "m", timeoutMs: 30 }).complete(hi).then(() => {
      throw new Error("expected timeout");
    }, (caught: unknown) => caught);
    expect(err).toMatchObject({ kind: "timeout" });
  });

  it("reports a caller abort separately from a timeout", async () => {
    const fetchImpl: typeof fetch = () => new Promise(() => undefined);
    const signal = AbortSignal.abort();
    const err = await client(fetchImpl, { apiKey: "k", model: "m" }).complete({ ...hi, signal }).then(() => {
      throw new Error("expected abort");
    }, (caught: unknown) => caught);
    expect(err).toMatchObject({ kind: "aborted" });
  });
});

describe("openaiProvider stream", () => {
  it("accumulates text and reports the finish reason", async () => {
    const fetchImpl = mockFetch(async (req) => {
      await req.text();
      return sse([
        "{\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Hel\"}}]}",
        "{\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"}}]}",
        "{\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}",
      ]);
    });
    const seen: string[] = [];
    const got = await client(fetchImpl, { apiKey: "k", model: "m" }).completeStream(hi, (content) => {
      seen.push(content);
    });
    expect(got.content).toBe("Hello");
    expect(got.finishReason).toBe("stop");
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[seen.length - 1]).toBe("Hello");
  });

  it("accumulates reasoning and content", async () => {
    const fetchImpl = mockFetch(() => sse([
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"reasoning\":\"Let me \"}}]}",
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning\":\"think.\"}}]}",
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Hi\"}}]}",
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}",
    ]));
    let lastContent = "";
    let lastThinking = "";
    const got = await client(fetchImpl, { apiKey: "k", model: "m" }).completeStream(hi, (content, thinking) => {
      lastContent = content;
      lastThinking = thinking;
    });
    expect(got.thinking).toBe("Let me think.");
    expect(got.content).toBe("Hi");
    expect(lastThinking).toBe("Let me think.");
    expect(lastContent).toBe("Hi");
  });

  it("reads reasoning_content and thinking as well as reasoning", async () => {
    const fetchImpl = mockFetch(() => sse([
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"A\"}}]}",
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"thinking\":\"B\"}}]}",
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}",
    ]));
    const got = await client(fetchImpl, { apiKey: "k", model: "m" }).completeStream(hi, () => undefined);
    expect(got.thinking).toBe("AB");
    expect(got.content).toBe("ok");
  });

  it("does not call progress for a tool-only stream", async () => {
    const fetchImpl = mockFetch(() => sse([
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"type\":\"function\",\"function\":{\"name\":\"demo__echo\",\"arguments\":\"\"}}]}}]}",
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{\\\"x\\\":1}\"}}]}}]}",
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}",
    ]));
    let called = 0;
    const got = await client(fetchImpl, { apiKey: "k", model: "m" }).completeStream({
      messages: [{ role: "user", content: "go" }],
      tools: [{ name: "demo__echo", description: "", parameters: { type: "object" } }],
    }, () => {
      called += 1;
    });
    expect(called).toBe(0);
    expect(got.toolCalls).toHaveLength(1);
    expect(got.toolCalls[0]?.name).toBe("demo__echo");
    expect(got.toolCalls[0]?.arguments).toContain("x");
    expect(thoughtSignature(got.toolCalls[0]?.raw)).toBe("skip_thought_signature_validator");
  });

  it("keeps parallel tool calls that reuse index 0", async () => {
    const fetchImpl = mockFetch(() => sse([
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"tool_calls\":[{\"index\":0,\"id\":\"a1\",\"type\":\"function\",\"function\":{\"name\":\"ytmusic__search_tracks\",\"arguments\":\"\"}}]}}]}",
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{\\\"q\\\":\\\"x\\\"}\"}}]}}]}",
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"b2\",\"type\":\"function\",\"function\":{\"name\":\"cast__devices_list\",\"arguments\":\"\"}}]}}]}",
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{}\"}}]}}]}",
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}",
    ]));
    const got = await client(fetchImpl, { apiKey: "k", model: "m" }).completeStream({
      messages: [{ role: "user", content: "play" }],
      tools: [
        { name: "ytmusic__search_tracks", description: "", parameters: { type: "object" } },
        { name: "cast__devices_list", description: "", parameters: { type: "object" } },
      ],
    }, () => undefined);
    expect(got.toolCalls).toHaveLength(2);
    expect(got.toolCalls[0]).toMatchObject({ name: "ytmusic__search_tracks", id: "a1" });
    expect(got.toolCalls[1]).toMatchObject({ name: "cast__devices_list", id: "b2" });
    expect(got.toolCalls[0]?.name).not.toContain("cast");
    expect(got.toolCalls[1]?.name).not.toContain("ytmusic");
  });

  it("binds a later index-only delta to the newest id and does not double a resent name", async () => {
    const fetchImpl = mockFetch(() => sse([
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"a1\",\"function\":{\"name\":\"ytmusic__\",\"arguments\":\"\"}}]}}]}",
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"search_tracks\",\"arguments\":\"{\\\"q\\\":\\\"x\\\"}\"}}]}}]}",
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"ytmusic__search_tracks\"}}]}}]}",
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"b2\",\"function\":{\"name\":\"cast__devices_list\",\"arguments\":\"{}\"}}]}}]}",
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\" \"}}]}}]}",
      "{\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}",
    ]));
    const got = await client(fetchImpl, { apiKey: "k", model: "m" }).completeStream(hi, () => undefined);
    expect(got.toolCalls.map((call) => call.name)).toEqual(["ytmusic__search_tracks", "cast__devices_list"]);
    expect(got.toolCalls[0]?.arguments).toBe("{\"q\":\"x\"}");
    expect(got.toolCalls[1]?.arguments).toBe("{} ");
  });

  it("asks for usage and reads it from the trailing chunk", async () => {
    let reqBody: Record<string, unknown> = {};
    const fetchImpl = mockFetch(async (req) => {
      reqBody = await readBody(req);
      return sse([
        "{\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"model\":\"gpt-stream\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Hi\"}}]}",
        "{\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"model\":\"gpt-stream\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}",
        "{\"id\":\"1\",\"object\":\"chat.completion.chunk\",\"model\":\"gpt-stream\",\"choices\":[],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":1,\"total_tokens\":10,\"prompt_tokens_details\":{\"cached_tokens\":4},\"completion_tokens_details\":{\"reasoning_tokens\":1}}}",
      ]);
    });
    const got = await client(fetchImpl, { apiKey: "k", model: "m" }).completeStream(hi, () => undefined);
    expect(obj(reqBody.stream_options)?.include_usage).toBe(true);
    expect(got.content).toBe("Hi");
    expect(got.finishReason).toBe("stop");
    expect(got.model).toBe("gpt-stream");
    expect(got.usage.prompt).toBe(9);
    expect(got.usage.completion).toBe(1);
    expect(got.usage.total).toBe(10);
    expect(got.usage.cached).toBe(4);
    expect(got.usage.reasoning).toBe(1);
  });

  it("does not stream a grammar-constrained reply", async () => {
    let streamed: unknown;
    const fetchImpl = mockFetch(async (req) => {
      const body = await readBody(req);
      streamed = body.stream;
      return json({
        id: "chatcmpl-test",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "{\"name\":\"garmin__hrv_get\",\"arguments\":{}}" },
        }],
      });
    });
    let progress = 0;
    const got = await client(fetchImpl).completeStream({
      messages: [{ role: "user", content: "hrv?" }],
      forceToolNames: ["garmin__hrv_get"],
    }, () => {
      progress += 1;
    });
    expect(streamed).not.toBe(true);
    expect(progress).toBe(0);
    expect(got.toolCalls).toHaveLength(1);
  });
});
