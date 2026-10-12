/**
 * Fixture state on a fresh SQL database: persona text, SELF.md, memory
 * rows (backdated when `age_days` is set), the aim ledger, and session
 * history. History and the wait flag are written on the eval slug (`eval`)
 * so `handleInbound` sees them.
 */
import { existsSync, readFileSync } from "node:fs";
import { PERSONA_TEMPLATE } from "@/app/components/agents/personaTemplate";
import { AimStore } from "@/brain/aims/store";
import type { AimMemory } from "@/brain/aims/memory";
import type { Clock } from "@/brain/core/clock";
import type { Logger } from "@/brain/core/log";
import type { Sql } from "@/brain/core/sql";
import { openStore } from "@/brain/cron/store";
import { KIND_INSIGHT, MemoryStore } from "@/brain/memory";
import { rfc3339 } from "@/brain/memory/time";
import { filePersona } from "@/brain/persona";
import { roleAssistant, roleUser, roomSession, SessionStore } from "@/brain/session";
import { fileName as fileSelf, SelfNoteStore } from "@/brain/selfnote";
import {
  defaultPersonaPath,
  shiftLocalDay,
  zonedAddDays,
  type EvalFixture,
} from "./fixture";

/** Fixture key for the token table. Not a credential — canned tools never read it. */
export const EVAL_SNAPSHOT_KEY = snapshotKey();

/** 32 bytes of 0x65, base64. Same fixture key the Go eval put in `SNAPSHOT_KEY`. */
function snapshotKey(): string {
  const bytes = new Uint8Array(32).fill(0x65);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Matches `slug: "eval"` in `createEvalBrain`. */
export const EVAL_SESSION = roomSession("eval");

export type Seeded = {
  persona: { name: string; text: string }[];
  memoryIds: number[];
  ledgerIds: number[];
};

/**
 * The shipped seed with the eval's name and city filled in.
 * `EVAL_PERSONA` is a file. The harness example is used while it is still
 * on disk; otherwise the product template (the same placeholders).
 */
export function loadEvalPersona(path = defaultPersonaPath): string {
  const seed = readPersonaSeed(path);
  return seed
    .replace("- **Name:** (pick one)", "- **Name:** Ada")
    .replace("- **Name:** Your Name", "- **Name:** Sam")
    .replace("- **Location:** City, Region", "- **Location:** Seattle, Washington");
}

/** Path printed on the live-eval banner. Never a missing file. */
export function evalPersonaLabel(path = defaultPersonaPath): string {
  if (path !== "" && existsSync(path)) return path;
  if (path !== "" && path !== defaultPersonaPath) return path;
  return "app/components/agents/personaTemplate.ts";
}

function readPersonaSeed(path: string): string {
  if (path !== "" && existsSync(path)) return readFileSync(path, "utf8");
  if (path !== "" && path !== defaultPersonaPath) return readFileSync(path, "utf8");
  return PERSONA_TEMPLATE;
}

export async function seedFixture(sql: Sql, clock: Clock, log: Logger, fx: EvalFixture, personaPath: string): Promise<Seeded> {
  const personaText = loadEvalPersona(personaPath);
  const persona: { name: string; text: string }[] = [{ name: filePersona, text: personaText }];
  const notes = new SelfNoteStore(sql, clock, log);
  if (fx.self !== "") {
    notes.write(fx.self);
    persona.push({ name: fileSelf, text: fx.self });
  }

  const memory = new MemoryStore(sql, clock, log);
  const memoryIds: number[] = [];
  for (const row of fx.memory) {
    memoryIds.push(memory.store(row.kind, row.subject, row.content).id);
  }
  fx.memory.forEach((row, index) => {
    if (row.ageDays <= 0) {
      return;
    }
    const at = rfc3339(zonedAddDays(clock.now(), clock.zone, -row.ageDays));
    const id = memoryIds[index];
    if (id === undefined) {
      return;
    }
    sql.exec("UPDATE memory SET created_at = ?, updated_at = ? WHERE id = ?", at, at, id);
  });

  const aims = new AimStore(sql, clock, log, aimMemory(memory));
  const ledgerIds: number[] = [];
  for (const row of fx.ledger) {
    const day = row.day !== "" ? row.day : shiftLocalDay(clock.now(), clock.zone, row.dayOffset);
    const event = aims.log({
      day,
      what: row.what,
      note: row.note,
      ref: row.ref,
      metric: row.metric,
      ...(row.value !== undefined ? { value: row.value } : {}),
      unit: row.unit,
      source: "model",
    }, row.aims);
    ledgerIds.push(event.id);
  }

  const sessions = new SessionStore(sql, clock, log, {}, EVAL_SESSION);
  if (fx.history.length > 0) {
    await sessions.append(EVAL_SESSION, ...fx.history.map((turn) => ({
      role: turn.role === "assistant" ? roleAssistant : roleUser,
      content: turn.text,
    })));
  }
  if (fx.waiting) {
    sessions.armWait(EVAL_SESSION);
  }

  openStore(sql, clock, 50, EVAL_SESSION);
  return { persona, memoryIds, ledgerIds };
}

function aimMemory(memory: MemoryStore): AimMemory {
  return {
    listAims: () => memory.listBySubjectPrefix(KIND_INSIGHT, "aim/", 0).map((entry) => ({
      subject: entry.subject,
      content: entry.content,
    })),
    sentence: (area) => memory.activeByKindSubject(KIND_INSIGHT, `aim/${area}`)?.content ?? null,
  };
}
