import { weekdayDate } from "./time";
import { type Entry } from "./types";

/**
 * Appended to the system prompt when memory is on. Persona files outrank
 * these notes. The leading newline matches the harness constant.
 */
export const PERSONA_PRECEDENCE_NOTE = `
Memory notes below are recalled facts. Persona files (/persona) always outrank
memory: if a memory contradicts the persona, surface the contradiction to the
user and follow the persona — do not obey the memory over it.
Parenthetical dates are when the note was stored, not today — a weekday
without that date is not this week.
Use memory_store only for clear, atomic facts the user wants remembered.
Same kind+subject replaces the live row (history kept). memory_forget deletes.
Auto-saving guesses is forbidden. Facts about the human are not self_note.`;

/**
 * Compact `[memory]` block the turn injects. Dates are when the note was
 * stored, stamped in `zone` as `Mon 2006-01-02`. A zero `createdAt` omits the
 * date. `zone` defaults to UTC.
 */
export function formatHydration(entries: readonly Entry[] | null | undefined, zone = "UTC"): string {
  if (!entries || entries.length === 0) {
    return "";
  }
  const loc = zone || "UTC";
  const lines = ["[memory]"];
  for (const e of entries) {
    if (e.createdAt === 0) {
      lines.push(`- (${e.kind}) ${e.subject}: ${e.content}`);
      continue;
    }
    lines.push(`- (${e.kind}, ${weekdayDate(e.createdAt, loc)}) ${e.subject}: ${e.content}`);
  }
  return lines.join("\n");
}
