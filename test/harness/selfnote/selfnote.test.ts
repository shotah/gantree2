import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock } from "@/harness/core/clock";
import { silentLogger } from "@/harness/core/log";
import { nodeSql, type NodeDatabase, type Sql } from "@/harness/core/sql";
import { type CallContext } from "@/harness/core/tools";
import { maxChars, selfNoteTool, SelfNoteStore, selfRowId } from "@/harness/selfnote";
import { utf8Length } from "@/harness/selfnote/stamp";

const ctx: CallContext = { userId: "u", sessionId: "s" };

function sql(): Sql {
  return nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase);
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  const first = result.content[0];
  return first?.type === "text" ? (first.text ?? "") : "";
}

describe("SelfNoteStore", () => {
  it("refreshes a stale header on open", () => {
    const db = sql();
    const old = "# SELF.md — Who You Are Becoming\n\n> old header from last year\n\n- dry humor";
    const store = new SelfNoteStore(db, fixedClock(1), silentLogger);
    db.exec("UPDATE selfnote SET body = ? WHERE id = ?", old, selfRowId);
    const again = new SelfNoteStore(db, fixedClock(1), silentLogger);
    const got = again.read();
    expect(got).not.toContain("old header from last year");
    expect(got).toContain("north-star aims");
    expect(got).toContain("Distill on `/new` merges");
    expect(got).toContain("- dry humor");
    expect(store.read()).toContain("- dry humor");
  });

  it("appends under the header and notifies", () => {
    const store = new SelfNoteStore(sql(), fixedClock(1), silentLogger);
    let changed = 0;
    store.onChange = () => {
      changed += 1;
    };
    store.append("opens 20-questions with a dramatic accusation");
    const got = store.read();
    expect(got.startsWith("# SELF.md")).toBe(true);
    expect(got).toContain("- opens 20-questions with a dramatic accusation");
    expect(changed).toBe(1);
    expect(() => {
      store.append("  ");
    }).toThrow(/empty note/);
  });

  it("refuses an append when the note is full", () => {
    const db = sql();
    const store = new SelfNoteStore(db, fixedClock(1), silentLogger);
    db.exec("UPDATE selfnote SET body = ? WHERE id = ?", "x".repeat(maxChars - 10), selfRowId);
    expect(() => {
      store.append("one more line that will not fit");
    }).toThrow(/full/);
  });

  it("replaces, clips, and refuses an empty write", () => {
    const store = new SelfNoteStore(sql(), fixedClock(1), silentLogger);
    expect(() => {
      store.write("");
    }).toThrow(/empty/);
    store.write("- no heading line");
    expect(store.read().startsWith("# SELF.md")).toBe(true);
    store.write(`# SELF.md — Who You Are Becoming\n${"y".repeat(2 * maxChars)}`);
    expect(utf8Length(store.read())).toBeLessThanOrEqual(maxChars);
  });
});

describe("self_note tool", () => {
  it("appends a note", async () => {
    const store = new SelfNoteStore(sql(), fixedClock(1), silentLogger);
    const tool = selfNoteTool(store);
    const out = await tool.call({ note: "calls the human Boss" }, ctx);
    expect(textOf(out)).toContain("appended");
    expect(store.read()).toContain("- calls the human Boss");
  });
});
