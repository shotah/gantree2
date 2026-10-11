import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock } from "@/brain/core/clock";
import { silentLogger } from "@/brain/core/log";
import { nodeSql, type NodeDatabase, type Sql } from "@/brain/core/sql";
import { textResult, type CallContext, type Tool } from "@/brain/core/tools";
import { maxChars, SelfNoteStore, SelfTools, selfRowId, ToolComposite, toolNote } from "@/brain/selfnote";
import { utf8Length } from "@/brain/selfnote/stamp";

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
  it("appends a note and rejects an unknown name", async () => {
    const store = new SelfNoteStore(sql(), fixedClock(1), silentLogger);
    const tools = new SelfTools(store);
    const out = await tools.call(toolNote, { note: "calls the human Boss" }, ctx);
    expect(textOf(out)).toContain("appended");
    expect(store.read()).toContain("- calls the human Boss");
    await expect(tools.call("self_bogus", {}, ctx)).rejects.toThrow(/unknown tool/);
  });

  it("merges the builtin tool ahead of the others and routes calls", async () => {
    const store = new SelfNoteStore(sql(), fixedClock(1), silentLogger);
    const other: Tool = {
      name: "demo__echo",
      description: "echo",
      inputSchema: { type: "object" },
      call: () => Promise.resolve(textResult("other-ok")),
    };
    const composite = new ToolComposite(new SelfTools(store), [other]);
    const defs = composite.tools();
    expect(defs).toHaveLength(2);
    expect(defs[0]?.name).toBe(toolNote);
    expect(defs[1]?.name).toBe("demo__echo");
    expect(composite.toolCount()).toBe(2);
    expect(textOf(await composite.call("demo__echo", {}, ctx))).toBe("other-ok");
    await composite.call(toolNote, { note: "n" }, ctx);
    expect(store.read()).toContain("- n");
  });
});
