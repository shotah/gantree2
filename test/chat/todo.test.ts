import { describe, expect, it } from "vitest";
import { parseFrame } from "@/lib/chat/frame";
import {
  ageLabel,
  cleanTodoText,
  agentPublishedTodo,
  parseTodoBoard,
  parseTodoFrame,
  phoneMustNotPublishTodo,
  priorityMark,
  sortTodo,
  TODO_MAX,
  todoDoneCommand,
  todoPriority,
  todoStoreKey,
  todoWords,
} from "@/lib/chat/todo";

const dentist = { id: 412, slug: "dentist", text: "call to book a cleaning", at: "2026-09-23" };
const passport = { id: 418, slug: "passport", text: "renew, by Oct 15", at: "2026-09-26" };

describe("parseTodoBoard", () => {
  it("keeps the crane's rows in order and drops a bad row, not the list", () => {
    expect(parseTodoBoard([
      dentist,
      { id: 0, slug: "zero", text: "no id", at: "2026-09-26" },
      { id: 1.5, slug: "frac", text: "float id", at: "2026-09-26" },
      { id: 413, slug: "Bad Slug", text: "spaces", at: "2026-09-26" },
      { id: 414, slug: "empty", text: "   ", at: "2026-09-26" },
      { id: 415, slug: "no-text" },
      "junk",
      null,
      passport,
    ])).toEqual([dentist, passport]);
  });

  it("collapses whitespace, clips to 240 runes, lowercases the slug, and tolerates a missing date", () => {
    const rows = parseTodoBoard([
      { id: 1, slug: "Amazon", text: "  return\n\nthe   box  ", at: "nope" },
      { id: 2, slug: "long", text: "🙂".repeat(300) },
    ]);
    expect(rows[0]).toEqual({ id: 1, slug: "amazon", text: "return the box", at: "" });
    expect(Array.from(rows[1]?.text ?? "")).toHaveLength(240);
    expect(cleanTodoText(42)).toBe("");
  });

  it("drops a repeated id or slug — the slug is the identity", () => {
    expect(parseTodoBoard([dentist, { ...dentist, id: 999 }, { ...passport, id: 412 }])).toEqual([dentist]);
  });

  it("caps at the phone's tolerance and treats junk as an empty list", () => {
    const many = Array.from({ length: TODO_MAX + 5 }, (_, i) => ({ id: i + 1, slug: `t${i}`, text: `task ${i}`, at: "2026-09-26" }));
    expect(parseTodoBoard(many)).toHaveLength(TODO_MAX);
    expect(parseTodoBoard(undefined)).toEqual([]);
    expect(parseTodoBoard({ todo: [dentist] })).toEqual([]);
  });

  it("keeps a priority key the crane sent, drops a junk one, and leaves the marker in the words", () => {
    expect(parseTodoBoard([
      { ...dentist, priority: "urgent" },
      { ...passport, priority: "high" },
      { id: 1, slug: "p3", text: "!! file the extension", at: "2026-09-26", priority: "p3" },
      { id: 2, slug: "quiet", text: "water the plants", at: "2026-09-26", priority: 2 },
    ])).toEqual([
      { ...dentist, priority: "urgent" },
      { ...passport, priority: "high" },
      { id: 1, slug: "p3", text: "!! file the extension", at: "2026-09-26" },
      { id: 2, slug: "quiet", text: "water the plants", at: "2026-09-26" },
    ]);
  });

  it("is what parseFrame hangs on a todo frame", () => {
    expect(parseTodoFrame({ kind: "todo", todo: [dentist] })).toEqual([dentist]);
    const parsed = parseFrame(JSON.stringify({ kind: "todo", todo: [dentist, { id: "x" }] }));
    expect(parsed.ok && parsed.frame).toEqual({ kind: "todo", todo: [dentist] });
    const empty = parseFrame(JSON.stringify({ kind: "todo", todo: [] }));
    expect(empty.ok && empty.frame).toEqual({ kind: "todo", todo: [] });
  });
});

describe("todo helpers", () => {
  it("gates by role, keys the store by owner, and spells the one write", () => {
    expect(phoneMustNotPublishTodo("phone", "todo")).toBe(true);
    expect(phoneMustNotPublishTodo("crane", "todo")).toBe(false);
    expect(agentPublishedTodo("crane", "todo")).toBe(true);
    expect(agentPublishedTodo("phone", "todo")).toBe(false);
    expect(todoStoreKey()).toBe("todo");
    expect(todoStoreKey("  ")).toBe("todo");
    expect(todoStoreKey("1182")).toBe("todo:1182");
    expect(todoDoneCommand(412)).toBe("/todo done 412");
  });

  it("reads the marker leading the words — !! urgent, ! high, none normal — and the key wins over it", () => {
    expect(todoPriority({ text: "!! file the extension" })).toBe("urgent");
    expect(todoPriority({ text: "!file the extension" })).toBe("high");
    expect(todoPriority({ text: "! renew, by Oct 15" })).toBe("high");
    expect(todoPriority({ text: "renew, by Oct 15" })).toBe("normal");
    expect(todoPriority({ text: "!!" })).toBe("normal");
    expect(todoPriority({ text: "wow!! really" })).toBe("normal");
    expect(todoPriority({ text: "! low key", priority: "urgent" })).toBe("urgent");
    expect(todoPriority({ text: "plain", priority: "high" })).toBe("high");

    expect(todoWords({ text: "!! file the extension" })).toBe("file the extension");
    expect(todoWords({ text: "!file the extension" })).toBe("file the extension");
    expect(todoWords({ text: "renew, by Oct 15" })).toBe("renew, by Oct 15");
    expect(todoWords({ text: "!!" })).toBe("!!");

    expect(priorityMark("urgent")).toBe("!!");
    expect(priorityMark("high")).toBe("!");
    expect(priorityMark("normal")).toBe("");
  });

  it("sorts urgent, then high, then the rest, keeping the crane's order inside a tier and the input untouched", () => {
    const a = { id: 1, slug: "a", text: "oldest normal", at: "2026-09-01" };
    const b = { id: 2, slug: "b", text: "! older high", at: "2026-09-02" };
    const c = { id: 3, slug: "c", text: "!! urgent", at: "2026-09-03" };
    const d = { id: 4, slug: "d", text: "newer normal", at: "2026-09-04" };
    const e = { id: 5, slug: "e", text: "keyed high", at: "2026-09-05", priority: "high" as const };
    const input = [a, b, c, d, e];
    expect(sortTodo(input).map((r) => r.slug)).toEqual(["c", "b", "e", "a", "d"]);
    expect(input.map((r) => r.slug)).toEqual(["a", "b", "c", "d", "e"]);
    expect(sortTodo([])).toEqual([]);
  });

  it("ages after the first day, says nothing today, on junk, or in the future", () => {
    const now = new Date(2026, 8, 26, 15, 0, 0);
    expect(ageLabel("2026-09-26", now)).toBe("");
    expect(ageLabel("2026-09-25", now)).toBe("1d ago");
    expect(ageLabel("2026-09-17", now)).toBe("9d ago");
    expect(ageLabel("2026-09-27", now)).toBe("");
    expect(ageLabel("", now)).toBe("");
    expect(ageLabel("2026-13-40", now)).toBe("");
  });
});
