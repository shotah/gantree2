import { describe, expect, it } from "vitest";
import { createBrain } from "@/brain/agent";
import { collapseOldToolResults } from "@/brain/agent/bound";
import { stripHarnessContext } from "@/brain/agent/judgment";
import type { Message } from "@/brain/core/provider";
import { collect, echoPlugin, scriptResult, Scripted, testDeps } from "./fixture";

const USER = { kind: "inbound" as const, user_id: "u1", id: "m1", text: "Hello" };

describe("createBrain turns", () => {
  it("streams one text turn as typing, draft, reply, boards, perf", async () => {
    const provider = new Scripted([
      scriptResult({ content: "Hello", toolCalls: [] }),
    ]);
    const brain = createBrain(testDeps({ provider }));
    const { emit, frames } = collect();
    await brain.handleInbound(USER, emit);
    expect(frames.map((frame) => frame.kind)).toEqual([
      "typing", "draft", "reply", "aims", "todo", "perf",
    ]);
    expect(frames[0]).toMatchObject({ kind: "typing", user_id: "u1" });
    expect(frames[1]).toMatchObject({ kind: "draft", user_id: "u1", text: "Hello" });
    expect(frames[2]).toMatchObject({ kind: "reply", user_id: "u1", text: "Hello" });
    expect(frames[3]).toMatchObject({ kind: "aims", aims: [] });
    expect(frames[4]).toMatchObject({ kind: "todo", todo: [] });
    expect(frames[5]).toMatchObject({
      kind: "perf",
      turn: "ada",
      source: "user",
      outcome: "ok",
      user_id: "u1",
      tokens: { prompt: 3, completion: 5 },
    });
  });

  it("streams a tool turn with a compact trace then the answer", async () => {
    const provider = new Scripted([
      scriptResult({
        content: "",
        toolCalls: [{ id: "c1", name: "demo__echo", arguments: "{}" }],
      }),
      scriptResult({ content: "You like espresso.", toolCalls: [] }),
    ]);
    const brain = createBrain(testDeps({
      provider,
      plugins: [echoPlugin("demo", [{ name: "echo", text: "pong" }])],
    }));
    const { emit, frames } = collect();
    await brain.handleInbound({ ...USER, text: "coffee?" }, emit);
    expect(frames.map((frame) => frame.kind)).toEqual([
      "typing", "draft", "draft", "draft", "reply", "aims", "todo", "perf",
    ]);
    expect(frames[1]).toMatchObject({ kind: "draft", text: "Making Calls:" });
    expect(frames[2]).toMatchObject({ kind: "draft", text: "Making Calls: ✓" });
    expect(frames[3]).toMatchObject({ kind: "draft", text: "Making Calls: ✓\n\nYou like espresso." });
    expect(frames[4]).toMatchObject({ kind: "reply", text: "Making Calls: ✓\n\nYou like espresso.", user_id: "u1" });
    expect(frames[7]).toMatchObject({ kind: "perf", outcome: "ok", tool_calls: 1, iterations: 2 });
    const stored = provider.requests[1]?.messages.find((m) => m.role === "tool");
    expect(stored?.content).toContain("pong");
  });

  it("runs a parallel batch and feeds results back in call order", async () => {
    const provider = new Scripted([
      scriptResult({
        content: "",
        toolCalls: [
          { id: "a", name: "demo__one", arguments: "{}" },
          { id: "b", name: "demo__two", arguments: "{}" },
        ],
      }),
      scriptResult({ content: "both", toolCalls: [] }),
    ]);
    const brain = createBrain(testDeps({
      provider,
      plugins: [echoPlugin("demo", [
        { name: "one", text: "ONE" },
        { name: "two", text: "TWO" },
      ])],
    }));
    const { emit } = collect();
    await brain.handleInbound(USER, emit);
    const tools = provider.requests[1]?.messages.filter((m) => m.role === "tool") ?? [];
    expect(tools.map((m) => m.toolCallId)).toEqual(["a", "b"]);
    expect(tools.map((m) => m.content)).toEqual(["ONE", "TWO"]);
  });

  it("answers /help without a model call or a perf frame", async () => {
    const provider = new Scripted([]);
    const brain = createBrain(testDeps({ provider }));
    const { emit, frames } = collect();
    await brain.handleInbound({ ...USER, text: "/help" }, emit);
    expect(provider.requests).toHaveLength(0);
    expect(frames.map((frame) => frame.kind)).toEqual(["reply"]);
    const help = frames[0];
    expect(help && "text" in help ? help.text : "").toContain("reset this session");
  });

  it("records an all-positive reaction without a model call", async () => {
    const provider = new Scripted([
      scriptResult({ content: "noted", toolCalls: [] }),
      scriptResult({ content: "next up", toolCalls: [] }),
    ]);
    const brain = createBrain(testDeps({ provider }));
    const { emit, frames } = collect();
    await brain.handleInbound(USER, emit);
    const reply = frames.find((frame) => frame.kind === "reply");
    const replyId = reply && "id" in reply ? reply.id ?? "" : "";
    frames.length = 0;
    await brain.handleInbound({ kind: "react", user_id: "u1", id: replyId, text: "👍" }, emit);
    expect(provider.requests).toHaveLength(1);
    expect(frames.map((frame) => frame.kind)).toEqual(["perf"]);
    expect(frames[0]).toMatchObject({
      kind: "perf",
      source: "reaction",
      outcome: "silent",
      iterations: 0,
      tool_calls: 0,
      user_id: "u1",
    });
    await brain.handleInbound({ ...USER, text: "and then?" }, emit);
    const history = provider.requests[1]?.messages.map((m) => m.content).join("\n") ?? "";
    expect(history).toContain("[reaction]");
    expect(history).toContain("[silent]");
  });

  it("cancels an in-flight turn without keeping the reply", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const provider = new Scripted([]);
    provider.complete = (req) => {
      entered();
      return held.then(() => {
        if (req.signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
        return scriptResult({ content: "late", toolCalls: [] });
      });
    };
    provider.completeStream = async (req, onProgress) => {
      const result = await provider.complete(req);
      if (result.content !== "") onProgress(result.content, "");
      return result;
    };
    const brain = createBrain(testDeps({ provider }));
    const { emit, frames } = collect();
    const turn = brain.handleInbound(USER, emit);
    await gate;
    await brain.handleInbound({ ...USER, id: "c", text: "/cancel" }, emit);
    release();
    await turn;
    expect(frames.map((frame) => frame.kind)).toContain("typing");
    expect(frames.some((frame) => frame.kind === "reply" && "text" in frame && (frame.text ?? "").includes("cancelled"))).toBe(true);
    expect(frames.some((frame) => frame.kind === "reply" && "text" in frame && frame.text === "late")).toBe(false);
    expect(frames.some((frame) => frame.kind === "perf" && "outcome" in frame && frame.outcome === "cancel")).toBe(true);
  });

  it("announce publishes status then the slash catalog", async () => {
    const brain = createBrain(testDeps({ provider: new Scripted([]) }));
    const { emit, frames } = collect();
    await brain.announce(emit);
    expect(frames.map((frame) => frame.kind)).toEqual(["status", "cmds"]);
    const cmds = frames[1];
    expect(cmds && "commands" in cmds ? cmds.commands?.some((cmd) => cmd.name === "help") : false).toBe(true);
  });

  it("drops a pasted harness block before the model sees the text", async () => {
    const provider = new Scripted([
      scriptResult({ content: "ok", toolCalls: [] }),
    ]);
    const brain = createBrain(testDeps({ provider }));
    const { emit } = collect();
    await brain.handleInbound({
      ...USER,
      text: "see you\n\n[harness]\n[current time] Monday",
    }, emit);
    const users = provider.requests[0]?.messages.filter((m) => m.role === "user").map((m) => m.content) ?? [];
    expect(users).toContain("see you");
    expect(users.join("\n")).not.toContain("[harness]");
  });
});

describe("collapseOldToolResults", () => {
  it("stubs tool results older than the last two rounds", () => {
    const messages: Message[] = [];
    for (let i = 0; i < 3; i += 1) {
      messages.push({
        role: "assistant",
        content: "",
        toolCalls: [{ id: `c${String(i)}`, name: "memory_recall", arguments: "{\"q\":1}" }],
      });
      messages.push({ role: "tool", toolCallId: `c${String(i)}`, content: "x".repeat(20) });
    }
    const out = collapseOldToolResults(messages);
    expect(out[1]?.content).toContain("truncated");
    expect(out[3]?.content).toBe("x".repeat(20));
    expect(out[5]?.content).toBe("x".repeat(20));
  });
});

describe("stripHarnessContext", () => {
  it("removes a harness block and keeps the human's words", () => {
    expect(stripHarnessContext("hello\n\n[memory]\nold row")).toBe("hello");
  });
});
