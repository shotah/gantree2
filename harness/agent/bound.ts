/**
 * Keep the last two tool rounds whole. Older rounds collapse to a one-line
 * marker so a parallel batch is not truncated before the model reads it.
 */
import type { Message, ToolCall } from "@/harness/core/provider";

export const KEEP_RECENT_TOOL_ROUNDS = 2;
const COLLAPSED_ARGS = "{}";

export function collapseOldToolResults(messages: readonly Message[]): Message[] {
  const roundOf = new Map<string, number>();
  let rounds = 0;
  for (const m of messages) {
    if (m.role !== "assistant" || !m.toolCalls || m.toolCalls.length === 0) continue;
    for (const tc of m.toolCalls) roundOf.set(tc.id, rounds);
    rounds += 1;
  }
  if (rounds <= KEEP_RECENT_TOOL_ROUNDS) return messages.slice();
  const oldestKept = rounds - KEEP_RECENT_TOOL_ROUNDS;
  const names = toolCallNames(messages);
  const out = messages.map((m) => ({ ...m, toolCalls: m.toolCalls ? m.toolCalls.map((tc) => ({ ...tc })) : undefined }));
  const collapsed = new Set<string>();
  let seen = 0;
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      seen += 1;
      continue;
    }
    if (m.role !== "tool") continue;
    const id = m.toolCallId ?? "";
    const round = roundOf.has(id) ? (roundOf.get(id) ?? 0) : seen - 1;
    if (round >= oldestKept) continue;
    const name = (id !== "" ? names.get(id) : "") || "result";
    const row = out[i];
    if (!row) continue;
    row.content = `[tool ${name}: ${String(m.content.length)} chars, truncated]`;
    if (id !== "") collapsed.add(id);
  }
  if (collapsed.size > 0) collapseArgs(out, collapsed);
  return out;
}

function collapseArgs(messages: Message[], collapsed: ReadonlySet<string>): void {
  for (const m of messages) {
    if (m.role !== "assistant" || !m.toolCalls) continue;
    m.toolCalls = m.toolCalls.map((tc) => (collapsed.has(tc.id) ? stubArgs(tc) : tc));
  }
}

function stubArgs(tc: ToolCall): ToolCall {
  const next: ToolCall = { ...tc, arguments: COLLAPSED_ARGS };
  if (next.raw == null) return next;
  if (!next.raw || typeof next.raw !== "object" || Array.isArray(next.raw)) {
    return { ...next, raw: undefined };
  }
  const payload: Record<string, unknown> = { ...next.raw };
  const fn = payload.function;
  if (fn && typeof fn === "object" && !Array.isArray(fn)) {
    payload.function = { ...fn, arguments: COLLAPSED_ARGS };
  }
  return { ...next, raw: payload };
}

function toolCallNames(messages: readonly Message[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== "assistant" || !m.toolCalls) continue;
    for (const tc of m.toolCalls) out.set(tc.id, tc.name);
  }
  return out;
}
