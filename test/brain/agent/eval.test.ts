import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expandEvalClock } from "@/brain/agent/temporal";
import { createBrain } from "@/brain/agent";
import { fixtureDir } from "@/brain/eval/fixture";
import { loadEvalPersona } from "@/brain/eval/seed";
import { filePersona } from "@/brain/persona";
import type { Plugin } from "@/brain/core/tools";
import { textResult } from "@/brain/core/tools";
import { collect, freshSql, scriptResult, Scripted, testDeps } from "./fixture";

const FIXTURES = fixtureDir;

function unknownList(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  const out: unknown[] = [];
  for (const item of value as unknown[]) out.push(item);
  return out;
}

function epochMs(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "string") return Number.NaN;
  const trimmed = value.replace(/(\.\d{3})\d+(Z)$/u, "$1$2");
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : Number(value);
}

function recordName(value: unknown): string {
  if (!value || typeof value !== "object" || !("name" in value)) return "";
  const name = value.name;
  return typeof name === "string" ? name : "";
}

describe("eval clock", () => {
  it("expands minute offsets to a clock with no space before the meridian", () => {
    const now = Date.parse("2026-09-14T12:00:00Z");
    const got = expandEvalClock(
      "Sprint is at {{+150m}}; take the scoop at {{+120m}}. Slept {{-30m}}.",
      now,
      "UTC",
    );
    expect(got).toBe("Sprint is at 2:30PM; take the scoop at 2:00PM. Slept 11:30AM.");
  });
});

describe("eval fixtures", () => {
  it("reads the offline scenario table", () => {
    const names = readdirSync(FIXTURES).filter((name) => name.endsWith(".json"));
    expect(names.length).toBeGreaterThanOrEqual(7);
    const seen = new Set<string>();
    for (const name of names) {
      const raw: unknown = JSON.parse(readFileSync(`${FIXTURES}/${name}`, "utf8"));
      if (!raw || typeof raw !== "object") throw new Error(`${name} is not an object`);
      const fx = raw as { name?: unknown; why?: unknown; inbound?: unknown; planner?: unknown; cron?: unknown; tools?: unknown };
      expect(typeof fx.name).toBe("string");
      expect(fx.name).not.toBe("");
      expect(seen.has(String(fx.name))).toBe(false);
      seen.add(String(fx.name));
      expect(typeof fx.why).toBe("string");
      expect(fx.why).not.toBe("");
      const hasInbound = typeof fx.inbound === "string" && fx.inbound !== "";
      if (!hasInbound && fx.planner !== true && !(typeof fx.cron === "string" && fx.cron !== "")) {
        throw new Error(`${name} needs inbound, planner, or cron`);
      }
      for (const tool of unknownList(fx.tools)) {
        const toolName = recordName(tool);
        if (!toolName.includes("__")) throw new Error(`${name} canned tool needs a server__name`);
      }
    }
  });

  it("a scripted scoop schedules cron, arms wait, and publishes the forced prefix", async () => {
    const raw: unknown = JSON.parse(readFileSync(`${FIXTURES}/01_scoop_at_2.json`, "utf8"));
    const fx = raw as { inbound: string };
    const now = Date.parse("2026-09-14T19:00:00Z");
    const text = expandEvalClock(fx.inbound, now, "America/Los_Angeles");
    const when = new Date(now + 120 * 60_000).toISOString();
    const provider = new Scripted([
      scriptResult({
        content: "",
        toolCalls: [{
          id: "c1",
          name: "cron_schedule",
          arguments: JSON.stringify({ prompt: "Take the scoop — sprint in 30.", when }),
        }],
      }),
      scriptResult({ content: "Scoop reminder set. Want the sprint on the calendar too?\n[wait]", toolCalls: [] }),
    ]);
    const google: Plugin = {
      name: "google",
      ready: () => Promise.resolve(null),
      tools: () => [{
        name: "calendar_list_events",
        description: "List calendar events for a day.",
        inputSchema: { type: "object", properties: { date: { type: "string" } } },
        call: () => Promise.resolve(textResult("[]")),
      }],
    };
    const sql = freshSql();
    const persona = loadEvalPersona();
    const brain = createBrain(testDeps({
      sql,
      provider,
      plugins: [google],
      persona: [{ name: filePersona, text: persona }],
      env: {
        MEMORY_CONSOLIDATE_MINUTES: "0",
        EXAMPLES_QTY: "0",
        DYNAMIC_TOOLS: "1",
        MCP_ENABLE_FORCE: "google",
        LLM_MODEL: "test-model",
      },
    }));
    const { emit, frames } = collect();
    await brain.handleInbound({ kind: "inbound", user_id: "u1", id: "m1", text }, emit);
    const names = provider.requests[0]?.tools?.map((tool) => tool.name) ?? [];
    for (const name of ["cron_schedule", "memory_store", "self_note", "mcp_enable", "google__calendar_list_events"]) {
      expect(names, name).toContain(name);
    }
    const user = provider.requests[0]?.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n") ?? "";
    expect(user).not.toContain("{{");
    expect(user).toContain("take the scoop at");
    const system = provider.requests[0]?.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n") ?? "";
    expect(system).toContain("## Identity");
    expect(system).toContain("**Name:**");
    const replyFrame = frames.find((frame) => frame.kind === "reply");
    const reply = replyFrame && "text" in replyFrame ? replyFrame.text ?? "" : "";
    expect(reply).not.toContain("[wait]");
    expect(reply).toContain("Scoop reminder set");
    const job = sql.one<{ prompt: string; next_run_at: number | string }>(
      "SELECT prompt, next_run_at FROM cron_job WHERE prompt LIKE ?",
      "%scoop%",
    );
    expect(job?.prompt).toContain("scoop");
    const next = epochMs(job?.next_run_at);
    expect(next).toBeGreaterThanOrEqual(now + 100 * 60_000);
    expect(next).toBeLessThanOrEqual(now + 140 * 60_000);
    const waiting = sql.one<{ waiting_for_reply: number }>(
      "SELECT waiting_for_reply FROM session WHERE id = ?",
      "gantry",
    );
    expect(waiting?.waiting_for_reply).toBe(1);
  });
});
