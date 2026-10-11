import { describe, expect, it } from "vitest";
import {
  formatLoops,
  formatTodo,
  HORIZON_MAX,
  memoryToolDefs,
  TOOL_STORE,
  todoBoard,
  todoPriority,
  todoWords,
  TODO_PRIORITY_HIGH,
  TODO_PRIORITY_NORMAL,
  TODO_PRIORITY_URGENT,
} from "@/brain/memory";
import { entry } from "./fixture";

const DAY = 24 * 60 * 60 * 1000;

describe("todo", () => {
  it("orders oldest first with ids and no stale cue", () => {
    expect(formatTodo(null)).toBe("");
    const now = Date.UTC(2026, 8, 26, 12, 0, 0);
    const rows = [
      entry({ id: 418, subject: "todo/passport", content: "renew, Wed 11am", updatedAt: now - 2 * 60 * 60 * 1000 }),
      entry({ id: 420, subject: "todo/amazon", content: "return the box", createdAt: now - 30 * DAY }),
      entry({ id: 412, subject: "todo/dentist", content: "call to book a cleaning", updatedAt: now - 3 * DAY }),
    ];
    const got = formatTodo(rows, now);
    expect(got).toBe("[todo] #420 amazon: return the box (30d ago) · #412 dentist: call to book a cleaning (3d ago) · #418 passport: renew, Wed 11am");
    expect(got).not.toContain("memory_forget");
    const loop = formatLoops([entry({ subject: "waiting/x", content: "n", createdAt: now - 30 * DAY })], null, now);
    expect(loop).toContain("resolve or memory_forget");
  });

  it("caps the stamp and points at /todo", () => {
    const many = Array.from({ length: 7 }, (_, i) => entry({
      id: i + 1,
      subject: `todo/t${String.fromCharCode(97 + i)}`,
      content: "n",
    }));
    const got = formatTodo(many);
    expect(got.split(" · ").length - 1).toBe(HORIZON_MAX - 1);
    expect(got.endsWith(" (+2 more — /todo)")).toBe(true);
    expect(got.startsWith("[todo] #1 ta: n · #2 tb: n")).toBe(true);
  });

  it("builds a phone board and drops bad rows", () => {
    const at = Date.UTC(2026, 8, 27, 5, 0, 0);
    const rows = [
      entry({ id: 418, subject: "todo/passport", content: "  renew,\n Wed 11am ", updatedAt: at }),
      entry({ id: 412, subject: "todo/dentist", content: "call to book a cleaning", updatedAt: at - 72 * 60 * 60 * 1000 }),
      entry({ id: 1, subject: "todo/Bad Slug", content: "x", updatedAt: at }),
      entry({ id: 2, subject: "todo/empty", content: "   ", updatedAt: at }),
      entry({ id: 3, subject: "todo/long", content: "y".repeat(300), updatedAt: at }),
    ];
    const board = todoBoard(rows, "America/Los_Angeles");
    expect(board.map((row) => row.id)).toEqual([412, 418, 3]);
    expect(board[1]).toMatchObject({ text: "renew, Wed 11am", at: "2026-09-26", slug: "passport" });
    expect(Array.from(board[2]?.text ?? "").length).toBe(240);
    expect(JSON.stringify(board[0])).toBe(`{"id":412,"slug":"dentist","text":"call to book a cleaning","at":"2026-09-23"}`);
    expect(todoBoard(null)).toEqual([]);
  });

  it("parses the leading marker", () => {
    const cases = [
      { in: "call to book a cleaning", level: TODO_PRIORITY_NORMAL, text: "call to book a cleaning", words: "call to book a cleaning" },
      { in: "! renew, by Oct 15", level: TODO_PRIORITY_HIGH, text: "renew, by Oct 15", words: "! renew, by Oct 15" },
      { in: "!!return the box", level: TODO_PRIORITY_URGENT, text: "return the box", words: "!! return the box" },
      { in: "  !!!  pay the fine ", level: TODO_PRIORITY_URGENT, text: "pay the fine", words: "!! pay the fine" },
      { in: "!!", level: TODO_PRIORITY_URGENT, text: "", words: "!!" },
      { in: "", level: TODO_PRIORITY_NORMAL, text: "", words: "" },
    ];
    for (const tc of cases) {
      const split = todoPriority(tc.in);
      expect(split).toEqual({ level: tc.level, text: tc.text });
      expect(todoWords(tc.in)).toBe(tc.words);
    }
  });

  it("sorts priority ahead of age", () => {
    const now = Date.UTC(2026, 9, 9, 12, 0, 0);
    const rows = [
      entry({ id: 420, subject: "todo/amazon", content: "return the box", updatedAt: now - 30 * DAY }),
      entry({ id: 430, subject: "todo/taxes", content: "!! file the extension", updatedAt: now - 60 * 60 * 1000 }),
      entry({ id: 412, subject: "todo/dentist", content: "! call to book a cleaning", updatedAt: now - 3 * DAY }),
      entry({ id: 418, subject: "todo/passport", content: "!renew, Wed 11am", updatedAt: now - 9 * DAY }),
    ];
    const got = formatTodo(rows, now);
    expect(got).toBe("[todo] #430 taxes: !! file the extension · #418 passport: ! renew, Wed 11am (9d ago) · #412 dentist: ! call to book a cleaning (3d ago) · #420 amazon: return the box (30d ago)");
    expect(rows[0]?.id).toBe(420);
    expect(rows[1]?.id).toBe(430);
  });

  it("puts priority on the wire and strips the marker from the text", () => {
    const at = Date.UTC(2026, 9, 9, 12, 0, 0);
    const rows = [
      entry({ id: 420, subject: "todo/amazon", content: "return the box", updatedAt: at - 72 * 60 * 60 * 1000 }),
      entry({ id: 430, subject: "todo/taxes", content: "!! file the extension", updatedAt: at }),
      entry({ id: 412, subject: "todo/dentist", content: "!  call to book a cleaning", updatedAt: at - 24 * 60 * 60 * 1000 }),
      entry({ id: 5, subject: "todo/bare", content: "!!", updatedAt: at }),
    ];
    const board = todoBoard(rows, "UTC");
    expect(board.map((row) => row.id)).toEqual([430, 412, 420]);
    expect(board[0]?.priority).toBe("urgent");
    expect(board[1]?.priority).toBe("high");
    expect(board[2]?.priority).toBeUndefined();
    expect(board[0]?.text).toBe("file the extension");
    expect(board[1]?.text).toBe("call to book a cleaning");
    expect(JSON.stringify(board[0])).toBe(`{"id":430,"slug":"taxes","text":"file the extension","at":"2026-10-09","priority":"urgent"}`);
    expect(JSON.stringify(board[2])).not.toContain("priority");
  });

  it("names the pocket list in the store tool description", () => {
    const desc = memoryToolDefs().find((d) => d.name === TOOL_STORE)?.description ?? "";
    for (const needle of [
      "todo/<slug>",
      "even in passing",
      "not follow/",
      "never ask whether to add it",
      "do it now",
      "no cron_schedule for it",
      "do not offer a reminder",
      "never memory_recall for it",
      "same subject rewrites",
      "memory_forget by the #id on [todo]",
      "only when they say so",
      "!! urgent",
      "! high",
      "leading the words",
      "your read of the stakes",
    ]) {
      expect(desc).toContain(needle);
    }
  });
});
