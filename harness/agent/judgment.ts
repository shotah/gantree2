/**
 * The loop's judgement: salvage a printed tool call, refuse invented cron
 * numbers, and tell a reaction from a question. Cue lists match the Go agent.
 */
import { parseToolCallTextHinted, prefixedToolNames } from "@/harness/provider/toolcalltext";
import { SilentToken } from "@/harness/cron/constants";
import { isSilentReply } from "@/harness/cron/silent";
import type { Message, ToolCall } from "@/harness/core/provider";
import { SOURCE_CRON, SOURCE_REACTION, SOURCE_USER, SOURCE_WATCH } from "./notes";

export { isSilentReply };

const TOOLS_FOOTER_PREFIX = "— tools:";

const LIVE_CUES = [
  "fetch", "search", "pull ", "query",
  "garmin", "strava", "ghealth",
  "calendar", "gmail", "inbox",
  "sheets", "ledger",
  "sleep", "hrv", "readiness", "body battery",
  "web_search", "google_search",
  "audit", "brief", "summarize",
];

const PROMISE_CUES = [
  "let me pull", "let me call", "let me query", "let me fetch", "let me check",
  "i'll pull", "i'll call", "i'll query", "i'll fetch", "i'll check", "i'll use",
  "i'll try", "i will try", "i'm going to try", "i am going to try",
  "i will call", "i will pull", "i will query", "going to call", "about to call",
  "going to access", "i'll access", "i am going to access", "i'm going to access",
  "query body battery", "call this function", "calling the", "call the tool",
];

const DEFERRAL_CUES = [
  "give me one moment", "give me a moment", "give me a second", "give me a minute",
  "one moment while", "just a moment", "one sec while", "hang tight",
  "hold on while i", "stand by while", "bear with me",
  "i'll try again", "i will try again", "let me try again", "trying again now",
  "i am going to try", "i'm going to try", "going to try to access",
  "i am going to access", "i'm going to access", "going to access that",
  "while i confirm", "while i check the connection", "confirm the connection",
];

const CLAIM_CUES = [
  "i've created", "i have created", "i've added", "i have added",
  "i've updated", "i have updated", "i've deleted", "i have deleted",
  "i've removed", "i have removed", "i've sent", "i have sent",
  "i've scheduled", "i have scheduled", "i've set up", "i have set up",
  "is now created", "has been created", "has been added", "has been sent",
];

const POSITIVE = new Set([
  "👍", "❤️", "❤", "🔥", "😂", "🙏", "👏", "💯",
  "✅", "🎉", "😍", "🤣", "👀", "🥰", "😊", "💪",
]);

const REACTION_PREFIX = "[reaction]";

export function turnSource(text: string): string {
  const t = text.trim();
  if (t.startsWith("[cron]")) return SOURCE_CRON;
  if (t.startsWith("[watch]")) return SOURCE_WATCH;
  if (t.startsWith("[reaction]")) return SOURCE_REACTION;
  return SOURCE_USER;
}

export function isToolsFooterLine(line: string): boolean {
  return line.trim().startsWith(TOOLS_FOOTER_PREFIX);
}

export function stripToolsFooter(s: string): string {
  const trimmed = s.replace(/\n+$/u, "");
  if (trimmed === "") return "";
  const lines = trimmed.split("\n");
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "").trim() === "") end -= 1;
  if (end > 0 && isToolsFooterLine(lines[end - 1] ?? "")) {
    end -= 1;
    while (end > 0 && (lines[end - 1] ?? "").trim() === "") end -= 1;
    return lines.slice(0, end).join("\n").replace(/\n+$/u, "");
  }
  return trimmed;
}

export function isToolsFooterOnly(s: string): boolean {
  const t = s.trim();
  if (t === "" || !t.includes(TOOLS_FOOTER_PREFIX)) return false;
  return stripToolsFooter(t).trim() === "";
}

export function withCronToolFooter(reply: string, called: readonly string[]): string {
  const label = called.length > 0 ? called.join(", ") : "(none)";
  return `${reply.replace(/\n+$/u, "")}\n\n— tools: ${label}`;
}

export function storedAssistantReply(reply: string): string {
  const stripped = stripToolsFooter(reply);
  if (stripped.trim() !== "") return stripped;
  return reply;
}

export function cronJobBody(userText: string): string {
  const t = userText.trim();
  if (!t.startsWith("[cron]")) return t;
  const i = t.indexOf("\n\n");
  if (i >= 0) return t.slice(i + 2).trim();
  return t;
}

export function cronJobImpliesLiveTools(userText: string): boolean {
  const text = cronJobBody(userText).toLowerCase();
  if (text.trim() === "") return false;
  return LIVE_CUES.some((cue) => text.includes(cue));
}

export function defersPendingWork(content: string): boolean {
  const text = content.toLowerCase();
  if (text.trim() === "") return false;
  return DEFERRAL_CUES.some((cue) => text.includes(cue));
}

export function promisesToolCall(content: string, thinking: string): boolean {
  const text = `${content}\n${thinking}`.toLowerCase();
  if (text.trim() === "") return false;
  if (text.includes("__")) return true;
  if (PROMISE_CUES.some((cue) => text.includes(cue))) return true;
  return defersPendingWork(content) || defersPendingWork(thinking);
}

export function claimsToolSuccess(content: string): boolean {
  const text = content.toLowerCase();
  if (text.trim() === "") return false;
  return CLAIM_CUES.some((cue) => text.includes(cue));
}

export function lastUserContent(messages: readonly Message[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m && m.role === "user" && !m.content.startsWith("[system] ")) return m.content;
  }
  return "";
}

export function dropCronHistory(history: readonly { role: string; content: string }[]): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = [];
  let skipAssistant = false;
  for (const h of history) {
    if (skipAssistant && h.role === "assistant") {
      skipAssistant = false;
      continue;
    }
    skipAssistant = false;
    if (h.role === "user") {
      const c = h.content.trim();
      if (c.startsWith("[cron]") || c.startsWith("[watch]")) {
        skipAssistant = true;
        continue;
      }
    }
    out.push(h);
  }
  return out;
}

export function salvageToolCall(content: string, defs: readonly { name: string }[], messages: readonly Message[]): ToolCall | null {
  const hints = lastAssistantToolHints(messages);
  const call = parseToolCallTextHinted(content, hints);
  if (!call) return null;
  if (call.name.includes("__")) return call;
  if (defs.some((def) => def.name === call.name)) return call;
  return null;
}

function lastAssistantToolHints(messages: readonly Message[]): string[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || m.role !== "assistant") continue;
    const names = prefixedToolNames(m.content);
    if (names.length === 1) return names;
    return [];
  }
  return [];
}

export function estMessageTokens(messages: readonly Message[]): number {
  let n = 0;
  for (const m of messages) {
    n += Math.trunc((m.content.length + 3) / 4);
    for (const tc of m.toolCalls ?? []) {
      n += Math.trunc((tc.arguments.length + 3) / 4);
    }
  }
  return n;
}

export function resultGenEst(content: string, thinking: string, calls: readonly ToolCall[]): number {
  let n = content.length + thinking.length;
  for (const tc of calls) n += tc.name.length + tc.arguments.length;
  if (n === 0) return 0;
  return Math.trunc((n + 3) / 4);
}

export function schemaTokens(defs: readonly { name: string; description: string; parameters: unknown }[]): number {
  let chars = 0;
  for (const d of defs) {
    chars += d.name.length + d.description.length;
    if (d.parameters) chars += JSON.stringify(d.parameters).length;
  }
  return Math.trunc(chars / 4);
}

export function firstLine(s: string, max = 100): string {
  for (const line of s.split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== "") return clipChars(trimmed, max);
  }
  return "";
}

export function clipChars(s: string, n: number): string {
  const runes = Array.from(s);
  if (runes.length <= n) return s;
  return `${runes.slice(0, n).join("")}…`;
}

export function parseReaction(text: string): { emojis: string[]; target: string } | null {
  const t = text.trim();
  if (!t.startsWith(`${REACTION_PREFIX} `)) return null;
  const rest = t.slice(REACTION_PREFIX.length).trim();
  const at = rest.indexOf(" on: ");
  const set = at >= 0 ? rest.slice(0, at) : rest;
  const target = at >= 0 ? rest.slice(at + " on: ".length).trim() : "";
  const emojis = set.split(/\s+/u).filter((part) => part !== "");
  if (emojis.length === 0) return null;
  return { emojis, target };
}

export function allPositive(emojis: readonly string[]): boolean {
  if (emojis.length === 0) return false;
  return emojis.every((e) => POSITIVE.has(e.trim()));
}

export function formatReaction(emojis: readonly string[], target: string): string {
  const clipped = clipReactionTarget(target);
  return `${REACTION_PREFIX} ${emojis.join(" ")} on: ${clipped}`;
}

function clipReactionTarget(s: string): string {
  const trimmed = s.trim();
  if (trimmed === "") return "(unknown message)";
  return clipChars(trimmed, 200);
}

const PALETTE = ["👍", "👎", "❤️", "🔥", "🤣", "😢", "🤔", "🙏", "👀", "🎉", "💯", "👏"];

export function inPalette(emoji: string): boolean {
  const e = emoji.trim();
  return PALETTE.some((p) => e === p || e === p.replace("\uFE0F", ""));
}

export function isSilentToken(s: string): boolean {
  return s.trim().toLowerCase() === SilentToken.toLowerCase();
}

const HARNESS_TAGS: { tag: string; word: string }[] = [
  { tag: "[location", word: "location" },
  { tag: "[current time]", word: "clock" },
  { tag: "[hours]", word: "hours" },
  { tag: "[aims]", word: "horizon" },
  { tag: "[todo]", word: "horizon" },
  { tag: "[loops]", word: "horizon" },
  { tag: "[progress]", word: "progress" },
  { tag: "[wakes]", word: "wakes" },
  { tag: "[surface]", word: "surface" },
  { tag: "[input]", word: "input" },
  { tag: "[room]", word: "room" },
  { tag: "[last contact]", word: "last contact" },
];

export function formatHarnessClock(clock: string): string {
  const body = clock.trim();
  if (body === "") return "";
  return `${harnessNote(body)}\n${body}`;
}

function harnessNote(clock: string): string {
  const words: string[] = [];
  for (const t of HARNESS_TAGS) {
    if (!clock.includes(t.tag)) continue;
    if (words.length > 0 && words[words.length - 1] === t.word) continue;
    words.push(t.word);
  }
  return `[agent] Not user text — ${joinAnd(words)} for this turn.`;
}

function joinAnd(words: readonly string[]): string {
  if (words.length === 0) return "context";
  if (words.length === 1) return words[0] ?? "context";
  if (words.length === 2) return `${words[0] ?? ""} and ${words[1] ?? ""}`;
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1] ?? ""}`;
}

function harnessTagLine(line: string): boolean {
  if (line.startsWith("[agent]") || line.startsWith("[harness]") || line.startsWith("[memory]")) return true;
  return HARNESS_TAGS.some((t) => line.startsWith(t.tag));
}

export function stripHarnessContext(s: string): string {
  const trimmed = s.trim();
  if (trimmed === "") return "";
  const kept: string[] = [];
  for (const part of trimmed.split("\n\n")) {
    if (harnessBlock(part)) continue;
    const next = stripTrailingHarnessLines(part).replace(/\n+$/u, "");
    if (next.trim() === "") continue;
    kept.push(next);
  }
  return kept.join("\n\n").trim();
}

function harnessBlock(s: string): boolean {
  for (const line of s.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    return harnessTagLine(trimmed);
  }
  return false;
}

function stripTrailingHarnessLines(s: string): string {
  const lines = s.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!harnessTagLine((lines[i] ?? "").trim())) continue;
    if (i === 0) return s;
    return lines.slice(0, i).join("\n");
  }
  return s;
}

export function parseCommand(text: string): string | null {
  const fields = text.trim().split(/\s+/u).filter((part) => part !== "");
  if (fields.length !== 1) return null;
  let cmd = fields[0] ?? "";
  if (!cmd.startsWith("/")) return null;
  const at = cmd.indexOf("@");
  if (at >= 0) cmd = cmd.slice(0, at);
  return cmd.toLowerCase();
}
