/**
 * One turn's prompt: persona, SELF (already inside the persona), session
 * summary, history, memory hydration, then the human's words and the
 * `[agent]` clock. The stable prefix stays in front so a cache can keep it.
 */
import type { Message, ProviderToolDef } from "@/brain/core/provider";
import { footer } from "@/brain/session/store";
import { stripFillerHistory } from "@/brain/session/filler";
import { formatHydration, PERSONA_PRECEDENCE_NOTE } from "@/brain/memory/format";
import { DEFAULT_HYDRATE_LIMIT } from "@/brain/memory/types";
import type { HereStore } from "@/brain/here";
import type { SessionStore } from "@/brain/session/store";
import type { MemoryStore } from "@/brain/memory/store";
import type { AimStore } from "@/brain/aims/store";
import type { EnableStore } from "@/brain/tools/enable";
import { formatIndex } from "@/brain/tools/enable";
import type { Registry } from "@/brain/tools/registry";
import type { Store as CronStore } from "@/brain/cron/store";
import { isDailyPlannerTurn } from "@/brain/cron/planner";
import { isFollowUpTurn } from "@/brain/cron/wait";
import { temporalAnchor } from "./temporal";
import {
  dropStamped,
  hoursLine,
  horizonStamp,
  inputLine,
  lastContactLine,
  loadHorizon,
  surfaceLine,
  wakesLine,
} from "./harness";
import {
  dropCronHistory,
  formatHarnessClock,
  schemaTokens,
  stripToolsFooter,
  turnSource,
} from "./judgment";
import {
  CRON_TOOL_FIRST_NOTE,
  ENABLE_REVIEW_NOTE,
  PLANNER_TOOL_FIRST_NOTE,
  SOURCE_CRON,
  SOURCE_WATCH,
  TOOL_NARRATION_NOTE,
  WAIT_REPLY_NOTE,
} from "./notes";

export type TurnIn = {
  sessionId: string;
  userId: string;
  /** Harness blocks already stripped. `[cron]` / `[watch]` / `[reaction]` stay. */
  text: string;
  images: string[];
  surface: string;
  input: string;
  noTools: boolean;
};

export type Assembler = {
  persona: () => string;
  zone: () => string;
  sessions: SessionStore;
  memory: MemoryStore;
  aims: AimStore;
  here: HereStore;
  enable: EnableStore;
  registry: Registry;
  cron: CronStore;
  now: () => number;
  stripFillers: boolean;
  dynamic: boolean;
  force: readonly string[];
};

export type Assembled = {
  messages: Message[];
  tools: ProviderToolDef[];
  hydration: number;
  schemas: number;
  stableEnd: number;
};

export function assemble(a: Assembler, turn: TurnIn): Assembled {
  const messages: Message[] = [];
  const persona = a.persona().trim();
  if (persona !== "") messages.push({ role: "system", content: persona });
  const summary = a.sessions.summary(turn.sessionId).trim();
  if (summary !== "") messages.push({ role: "system", content: `[session summary]\n${summary}` });

  const enabled = a.enable.list(turn.sessionId).map((row) => row.prefix);
  const indexBlock = a.dynamic
    ? formatIndex(a.enable.list(turn.sessionId), a.registry.indexKeys(), { prefixes: a.force })
    : "";
  if (indexBlock !== "") messages.push({ role: "system", content: indexBlock });

  const source = turnSource(turn.text);
  let history = a.sessions.messages(turn.sessionId);
  if (source === SOURCE_CRON || source === SOURCE_WATCH) history = dropCronHistory(history);
  if (a.stripFillers) history = stripFillerHistory(history);
  for (const h of history) {
    let content = h.content;
    if (h.role === "assistant") {
      content = stripToolsFooter(content);
      if (content.trim() === "") continue;
    }
    if (h.role !== "user" && h.role !== "assistant") continue;
    const role: "user" | "assistant" = h.role === "assistant" ? "assistant" : "user";
    messages.push({ role, content });
  }
  const stableEnd = messages.length;

  const hz = loadHorizon(a.memory);
  let hydration = 0;
  const entries = dropStamped(hz, a.memory.hydrate(turn.text, DEFAULT_HYDRATE_LIMIT));
  const block = formatHydration(entries, a.zone());
  if (block !== "") {
    hydration = Math.trunc((block.length + 3) / 4);
    messages.push({ role: "system", content: block });
  }

  const user: Message = { role: "user", content: turn.text === "" ? "[photo]" : turn.text };
  if (turn.images.length > 0) user.imageUrls = turn.images.slice();

  const toolsOff = turn.noTools;
  const defs = toolsOff
    ? []
    : a.registry.list(enabled).map((def) => ({
        name: def.name,
        description: def.description,
        parameters: def.inputSchema,
      }));

  const now = a.now();
  const zone = a.zone();
  let clock = temporalAnchor(now, zone, zone);
  const pin = a.here.format(turn.sessionId, zone);
  if (pin !== "") clock = `${pin}\n${clock}`;
  const hours = hoursLine(a.memory);
  if (hours !== "") clock += `\n${hours}`;
  clock += horizonStamp(hz, now, zone, a.aims, turn.text);
  const wakes = wakesLine(a.cron.listSession(turn.sessionId, false), now, zone);
  if (wakes !== "") clock += `\n${wakes}`;
  const surface = surfaceLine(turn.surface);
  if (surface !== "") clock += `\n${surface}`;
  const input = inputLine(turn.input, turn.surface);
  if (input !== "") clock += `\n${input}`;
  const contact = lastContactLine(a.sessions.lastUserAt(turn.sessionId), now, zone);
  if (contact !== "") clock += `\n${contact}`;

  messages.push(user);
  const harness = formatHarnessClock(clock);
  if (harness !== "") messages.push({ role: "system", content: harness });
  messages.push({ role: "system", content: WAIT_REPLY_NOTE });
  const talk = footer(a.sessions.talkState(turn.sessionId));
  if (talk !== "") messages.push({ role: "system", content: talk });
  if (indexBlock !== "") messages.push({ role: "system", content: ENABLE_REVIEW_NOTE });
  if (source === SOURCE_CRON && defs.length > 0 && !isFollowUpTurn(turn.text)) {
    const note = isDailyPlannerTurn(turn.text) ? PLANNER_TOOL_FIRST_NOTE : CRON_TOOL_FIRST_NOTE;
    messages.push({ role: "system", content: note });
  }

  return {
    messages,
    tools: defs,
    hydration,
    schemas: schemaTokens(defs),
    stableEnd,
  };
}

/** Persona the model sees: operator text, SELF, narration, memory precedence. */
export function standingPersona(assembled: string): string {
  const base = assembled.trim();
  const notes = `${TOOL_NARRATION_NOTE}\n${PERSONA_PRECEDENCE_NOTE.trim()}`;
  if (base === "") return notes;
  return `${base}\n${notes}`;
}
