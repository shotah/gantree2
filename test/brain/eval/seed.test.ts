import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock } from "@/brain/core/clock";
import { makeLogger, memorySink } from "@/brain/core/log";
import { nodeSql, type NodeDatabase } from "@/brain/core/sql";
import { rfc3339 } from "@/brain/memory/time";
import { SessionStore } from "@/brain/session";
import { SelfNoteStore } from "@/brain/selfnote";
import { defaultPersonaPath, EVAL_TZ, fixtureDir, loadEvalFixture, zonedAddDays } from "@/brain/eval/fixture";
import { EVAL_INBOUND_ID, EVAL_USER, inboundFrame } from "@/brain/eval/run";
import { EVAL_SESSION, loadEvalPersona, seedFixture } from "@/brain/eval/seed";

function world(at: number) {
  const db = new DatabaseSync(":memory:");
  const sql = nodeSql(db as unknown as NodeDatabase);
  const clock = fixedClock(at, EVAL_TZ);
  const log = makeLogger(memorySink(), () => clock.now());
  return { db, sql, clock, log };
}

describe("eval seed", () => {
  it("fills the shipped persona's name and city", () => {
    const text = loadEvalPersona();
    expect(text).toContain("- **Name:** Kit");
    expect(text).toContain("- **Name:** Sam");
    expect(text).toContain("Seattle, Washington");
  });

  it("backdates aged memory, stores ledger ids, arms the wait, and writes SELF.md", async () => {
    const at = Date.parse("2026-10-11T19:00:00Z");
    const done = world(at);
    try {
      const fx = loadEvalFixture(join(fixtureDir, "23_chat_todo_done.json"));
      const seeded = await seedFixture(done.sql, done.clock, done.log, fx, defaultPersonaPath);
      expect(seeded.memoryIds).toHaveLength(4);
      const aged = done.sql.one<{ created_at: string }>("SELECT created_at FROM memory WHERE subject = ?", "todo/dentist");
      expect(aged?.created_at).toBe(rfc3339(zonedAddDays(at, EVAL_TZ, -3)));
      const fresh = done.sql.one<{ created_at: string }>("SELECT created_at FROM memory WHERE subject = ?", "dentist");
      expect(fresh?.created_at).toBe(rfc3339(at));
    } finally {
      done.db.close();
    }

    const gym = world(at);
    try {
      const fx = loadEvalFixture(join(fixtureDir, "16_planner_streak_credit.json"));
      const seeded = await seedFixture(gym.sql, gym.clock, gym.log, fx, defaultPersonaPath);
      expect(seeded.ledgerIds).toHaveLength(3);
      expect(new Set(seeded.ledgerIds).size).toBe(3);
    } finally {
      gym.db.close();
    }

    const shoes = world(at);
    try {
      const fx = loadEvalFixture(join(fixtureDir, "07_planner_gym_no_workout.json"));
      await seedFixture(shoes.sql, shoes.clock, shoes.log, fx, defaultPersonaPath);
      expect(new SelfNoteStore(shoes.sql, shoes.clock, shoes.log).read()).toContain("shoes by the door");
    } finally {
      shoes.db.close();
    }

    const waiting = world(at);
    try {
      const fx = loadEvalFixture(join(fixtureDir, "14_reaction_waiting_thumbs_up.json"));
      await seedFixture(waiting.sql, waiting.clock, waiting.log, fx, defaultPersonaPath);
      const sessions = new SessionStore(waiting.sql, waiting.clock, waiting.log);
      expect(sessions.messages(EVAL_SESSION).map((message) => message.role)).toEqual(["user", "assistant"]);
      expect(sessions.talkState(EVAL_SESSION).waitingForReply).toBe(true);
    } finally {
      waiting.db.close();
    }
  });

  it("stamps surface and typed input on the inbound frame", () => {
    const fx = loadEvalFixture(join(fixtureDir, "22b_chat_todo_add_phone.json"));
    const frame = inboundFrame(fx, "call mom", Date.parse("2026-10-11T19:00:00Z"));
    expect(frame.kind).toBe("inbound");
    expect(frame.user_id).toBe(EVAL_USER);
    expect(frame.id).toBe(EVAL_INBOUND_ID);
    expect(frame.text).toBe("call mom");
    expect(frame.context?.surface).toBe("android");
    expect(frame.context?.tz).toBe(EVAL_TZ);
    const input = frame.context as { input?: string } | undefined;
    expect(input?.input).toBe("typed");
  });
});
