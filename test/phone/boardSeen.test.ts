import { describe, expect, it } from "vitest";
import type { AimRow } from "@/lib/chat/aims";
import type { TodoItem } from "@/lib/chat/todo";
import {
  AIMS_SEEN_KEY,
  aimKey,
  boardFingerprint,
  boardSeenPref,
  changedRows,
  TODO_SEEN_KEY,
  todoKey,
  writeBoardSeenPref,
} from "@/lib/phone/boardSeen";

function row(area: string, sum7 = 6): AimRow {
  return { area, sentence: `${area} sentence`, rating30: 1.4, sum7, streak: 2, note: "asked", days: [] };
}

function task(slug: string, id = 1, text = `${slug} words`): TodoItem {
  return { id, slug, text, at: "2026-09-26" };
}

function memStorage() {
  const mem = new Map<string, string>();
  return {
    mem,
    storage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
    },
  };
}

describe("changedRows", () => {
  it("counts a never-seen board whole and a seen board as nothing", () => {
    const board = [row("training"), row("weight")];
    expect(changedRows(board, {}, aimKey)).toBe(2);
    expect(changedRows(board, boardFingerprint(board, aimKey), aimKey)).toBe(0);
  });

  it("counts new, changed, and gone rows — not the ones that stayed the same", () => {
    const seen = boardFingerprint([row("training"), row("weight"), row("sleep")], aimKey);
    // training same, weight changed, sleep gone, reading new.
    expect(changedRows([row("training"), row("weight", 7), row("reading")], seen, aimKey)).toBe(3);
  });

  it("keys a task by slug, so a rewrite (new id, new words) is one change, not two", () => {
    const seen = boardFingerprint([task("dentist", 412), task("passport", 418)], todoKey);
    expect(changedRows([task("dentist", 420, "book it for Thursday"), task("passport", 418)], seen, todoKey)).toBe(1);
    // Done: the row is gone. That is one thing to look at too.
    expect(changedRows([task("passport", 418)], seen, todoKey)).toBe(1);
  });

  it("reads an empty board as no changes when nothing was seen", () => {
    expect(changedRows([], {}, aimKey)).toBe(0);
  });
});

describe("board seen pref", () => {
  it("round-trips through storage under its own key and drops junk", () => {
    const { mem, storage } = memStorage();
    expect(boardSeenPref(storage, AIMS_SEEN_KEY)).toEqual({});
    expect(boardSeenPref(null, AIMS_SEEN_KEY)).toEqual({});

    const seen = writeBoardSeenPref(storage, AIMS_SEEN_KEY, [row("training")], aimKey);
    expect(seen).toEqual(boardFingerprint([row("training")], aimKey));
    expect(boardSeenPref(storage, AIMS_SEEN_KEY)).toEqual(seen);
    writeBoardSeenPref(storage, TODO_SEEN_KEY, [task("dentist")], todoKey);
    expect(Object.keys(boardSeenPref(storage, TODO_SEEN_KEY))).toEqual(["dentist"]);
    expect(Object.keys(boardSeenPref(storage, AIMS_SEEN_KEY))).toEqual(["training"]);

    mem.set(AIMS_SEEN_KEY, "not json");
    expect(boardSeenPref(storage, AIMS_SEEN_KEY)).toEqual({});
    mem.set(AIMS_SEEN_KEY, JSON.stringify(["training"]));
    expect(boardSeenPref(storage, AIMS_SEEN_KEY)).toEqual({});
    mem.set(AIMS_SEEN_KEY, JSON.stringify({ training: "{}", weight: 3 }));
    expect(boardSeenPref(storage, AIMS_SEEN_KEY)).toEqual({ training: "{}" });
  });
});
