/**
 * Standing instructions the Go agent appended to the prompt. Wording is the
 * product's judgement — small models follow these lines, not a paraphrase.
 */

export const TOOL_TRACE_FULL = "full";
export const TOOL_TRACE_COMPACT = "compact";
export const TOOL_TRACE_OFF = "off";

export const COMPACT_CALLS_HEADER = "Making Calls:";

export const BUDGET_EXHAUSTED_REPLY = "I ran out of tool calls for this turn before I could finish. Ask again and I'll pick up where I left off.";

export const HANDLE_FAILED = "sorry — something went wrong handling that message";

export const CRON_SKIPPED_LIVE_REPLY = "Scheduled job needs live data, but no tools were called — I won't invent metrics. Ask me in chat if you want a live pull.";

export const STALL_GIVE_UP = "I couldn't finish that — tools failed and I stalled instead of retrying or giving up clearly. Please try again.";

export const THEATER_CUE_MAX_CHARS = 1500;

export const MAX_TOOL_ITERS_DEFAULT = 15;

export const SOURCE_USER = "user";
export const SOURCE_CRON = "cron";
export const SOURCE_WATCH = "watch";
export const SOURCE_REACTION = "reaction";

export const TOOL_NARRATION_NOTE = "When you need tools, emit every independent call in this same response — they run together. One short visible line for the whole batch (e.g. \"Checking calendar, mail, and memory\"), under a dozen words, then the calls. A later round is only for calls that need a prior result.";

export const ENABLE_REVIEW_NOTE = "[system] Review [mcp prefixes] on vs off this turn. If you need a tool whose prefix is off, call mcp_enable with every prefix this turn needs (one call). Schemas land on the next model call in this same turn — then call the tool. Do not claim you lack a tool that is listed off.";

export const CRON_TOOL_FIRST_NOTE = "[system] Scheduled turn: if this job needs live data, review [mcp prefixes] and mcp_enable any off prefix this job needs, then emit independent tool calls now in one response and wait for results. Do not invent metrics, events, or search results. Write the user-facing report only after tool results are in context. If no tools are needed, reply now.";

export const PLANNER_TOOL_FIRST_NOTE = "[system] Daily planner turn: one session for the day, one clock time. Review [mcp prefixes] on vs off. [hours], [aims], [todo], [loops], and [wakes] are already in [harness] — do not memory_recall or cron_list for those. Emit independent tool calls now — calendar, mail, Garmin (mcp_enable a prefix if it is off). Do not invent numbers or events. Then aim_log yesterday from those results (ref, every aim the event touches, 0 for a planned rest; on a quit aim a clean day is +1) and cron_schedule today's cues with memory_subject aim/<area>. Read [progress] and follow the ladder (a streak credit is note=praised); never repeat the last note. aim_history before changing the plan. A slip they already owned gets no lecture. Ask first before sending mail, spending, or posting. An event they already named: create it this turn, don't ask. Sick, vacation, holiday, or a quiet day they asked for: [silent], no nag crons. If this clock does not match their life, cron_schedule when=HH:MM repeat=planner (that persists; do not add a second planner). No [aims] line: ask ONE months-scale question — do not invent. A real empty calendar: ask ONE what they want on it today — not [silent], never agree-and-stop. If [room] is stamped and stale, redress it in the same batch. If you asked a question they should answer, put [wait] on its own line. The reply is the first [progress] rung, and [silent] is only when that rung says so: streak ≥3 and the last note is not praised → one credit line and aim_log note=praised (an empty today is not a rest day). Yesterday is negative and the last note is nudged → ask what is in the way, [wait], aim_log note=asked. A dinner or other meal on today's calendar against a weight aim → one meal line and aim_log that dinner, not [silent]. A weigh-in is aims score 0 with the tool's number on value, then [silent]. note=quiet is only for a slip the human already told you about. If weeks: is in [progress], start the reply with one line per aim from those numbers (direction, slope, block, the effect line if it is there); that is not [silent], and a missing r= is not a correlation. No weeks: line: do not summarize the week. A [todo] item whose words name today: cron_schedule its cue now with memory_subject=todo/<slug>, and the line says do it now — not good luck, not later. Each one overdue by its words, and the oldest past a week, is one line, a different line from yesterday, do it now — not the list, not [silent], never \"shall I drop it\". This turn was not asked by them: no closer, no \"Anything else\". [silent] stays [silent].";

export const WAIT_REPLY_NOTE = "[system] Follow-up is not a tool. A question they should answer: [wait] on its own line (they never see it). [nowait] drops the wait. If [conversation] waiting_for_reply=true, do not ask a new different question.";

export const TOOLS_FOOTER_NUDGE = "[system] That \"— tools:\" line is a harness audit footer, not a user-visible reply and not a tool call. Nothing ran from it. Write the actual answer as plain assistant text. If you still need data, emit real tool_calls via the tools API. Do not print \"— tools:\".";

export const THINKING_NUDGE_PREFIX = "[system] Your previous response contained only internal reasoning — no visible reply and no tool call. "
  + "Act now: call the tool(s) you decided on in one response (exact names from the tools list), "
  + "or write your final answer as plain assistant text (not only inside thinking). Your reasoning was:\n";

export const THEATER_NUDGE = "[system] You described or claimed a tool action, but no tool call was made — nothing actually happened. "
  + "Emit the real tool call(s) now using exact names from the tools list. "
  + "Independent lookups belong in one response. Do not narrate and never report results you did not receive from a tool.";

export const DEFERRAL_NUDGE = "[system] You said you would continue (try again / one moment / access next), but no tool call was made — the human is left hanging. "
  + "Act now: emit the real tool call(s) using exact names from the tools list, "
  + "OR give a final answer that reports the tool error and stops. Giving up is fine. "
  + "Do not ask for a moment or promise another attempt without calling a tool.";

export const PLANNER_NUDGE = "[system] This daily planner turn is the one planning session for the day, not an empty check-in. "
  + "[hours], [aims], [todo], [loops], and [wakes] are already in [harness] — do not recall them. Call tools now in one response: calendar, mail, Garmin, then aim_log, or cron_schedule. "
  + "mcp_enable a prefix if it is off and needed. Do not invent events or numbers. "
  + "If they are sick, on vacation, or off today, reply with exactly [silent] after you have seen the tools. "
  + "If there is no [aims] line, ask ONE months-scale question — do not invent an aim. "
  + "If the human does not need a message after the work, reply with exactly [silent].";

export const CRON_LIVE_NUDGE = "[system] This scheduled job needs live data, but you wrote the user-facing result without calling any tools. "
  + "Emit the real tool calls now in one response using exact names from the tools list. "
  + "Do not invent metrics, events, or search results. After tools return, then write the report. "
  + "If a tool fails, report the failure.";

export function budgetExhaustedNote(maxIters: number): string {
  return `[system] Tool budget exhausted: all ${String(maxIters)} tool rounds for this turn are used and no more tool calls are possible. `
    + "Write your final reply to the user now: summarize what you accomplished, what you found, and what is still unfinished.";
}

export function budgetWarnNote(used: number, maxIters: number): string {
  return `[system] Tool budget: ${String(used)} of ${String(maxIters)} tool rounds used this turn; ${String(maxIters - used)} remain before you must answer. Batch remaining independent calls, or wrap up now.`;
}

export const HARNESS_NUDGE_PREFIX = "[system] ";

export const SELF_DISTILL_MIN_MESSAGES = 6;

export const SELF_DISTILL_PROMPT = "[system] This chat session is about to be reset and its history erased. "
  + "Below are your current self-notes (SELF.md), the dying conversation, and (if present) a "
  + "[session voice] block — the rolling mood of this chat (jokes, nicknames, games). "
  + "Merge into a complete self-notes file so the personality you developed here survives. "
  + "Keep every existing SELF.md bullet that is a joke, nickname, game, ritual, or north-star aim unless it is a true duplicate. "
  + "Add from [session voice] using exact wording. Do not replace a quoted joke with a mood word. "
  + "A north-star aim is a months-scale sentence; keep those. Do not copy progress logs, one-off to-dos, or Facts: about the human. "
  + "Prefer exact wording from [session voice] over paraphrasing the transcript. "
  + "Skip one-off mood weather (\"dry today\"). Do not copy facts about the human into SELF.md. "
  + "Rules: output only the file content; start with the heading \"# SELF.md — Who You Are Becoming\"; "
  + "short \"- \" bullet lines, at most 30; notes describe YOUR personality, shared rituals, and a few north-star aims — "
  + "not facts about the human, not progress logs, not rules, not tool recipes.";
