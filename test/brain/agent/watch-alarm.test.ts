import { describe, expect, it } from "vitest";
import { createBrain } from "@/brain/agent";
import { asleepAt } from "@/brain/cron/hours";
import { fixedClock } from "@/brain/core/clock";
import { MemoryStore } from "@/brain/memory/store";
import { KIND_PREFERENCE, SUBJECT_HOURS } from "@/brain/memory/types";
import { GRID_MS, WatchStore, snapUpGrid } from "@/brain/watch";
import { freshSql, Scripted, testDeps } from "./fixture";

const SLEEP = "sleep: 23:00-07:00\nwork: 09:00-17:00\nquiet: (none)\n";

describe("watch alarms", () => {
  it("includes the watch grid slot and stays awake through quiet hours", () => {
    const now = Date.parse("2026-01-01T22:00:00Z");
    const clock = fixedClock(now, "UTC");
    const sql = freshSql();
    const brain = createBrain(testDeps({
      sql,
      clock,
      provider: new Scripted([]),
      env: { CRON_TZ: "UTC", MEMORY_CONSOLIDATE_MINUTES: "0", EXAMPLES_QTY: "0" },
    }));
    const before = brain.nextAlarm();
    const store = new WatchStore(sql, clock);
    const watch = store.add("feeds__items_list", { url: "https://example.com/rss.xml" }, "blog", 60 * 60, { sessionId: "s" });
    const offGrid = Date.parse("2026-01-01T22:07:00Z");
    sql.exec("UPDATE watch SET next_poll_at = ? WHERE id = ?", offGrid, watch.id);
    const snapped = brain.nextAlarm();
    expect(snapped).toBe(snapUpGrid(offGrid));
    expect(snapped).toBe(Date.parse("2026-01-01T22:10:00Z"));
    if (snapped == null) throw new Error("missing grid alarm");
    expect(snapped % GRID_MS).toBe(0);
    expect(before == null || snapped < before).toBe(true);

    new MemoryStore(sql, clock, testDeps({ provider: new Scripted([]), sql, clock }).log).store(
      KIND_PREFERENCE,
      SUBJECT_HOURS,
      SLEEP,
    );
    const inside = Date.parse("2026-01-01T23:30:00Z");
    sql.exec("UPDATE watch SET next_poll_at = ? WHERE id = ?", inside, watch.id);
    const afterQuiet = brain.nextAlarm();
    expect(afterQuiet).toBe(Date.parse("2026-01-02T07:00:00Z"));
    expect(asleepAt(SLEEP, inside, "UTC")).toBe(true);
    if (afterQuiet == null) throw new Error("missing quiet alarm");
    expect(asleepAt(SLEEP, afterQuiet, "UTC")).toBe(false);
    expect(afterQuiet % GRID_MS).toBe(0);
  });
});
