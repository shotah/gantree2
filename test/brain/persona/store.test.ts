import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock } from "@/brain/core/clock";
import { silentLogger } from "@/brain/core/log";
import { nodeSql, type NodeDatabase, type Sql } from "@/brain/core/sql";
import { assemblePersona, filePersona, fileSelf, MAX_CHARS, PersonaStore, preferredOrder } from "@/brain/persona";
import { utf8Length } from "@/brain/selfnote/stamp";

function fresh(): Sql {
  // `DatabaseSync` types its bindings narrower than `SqlValue` (no ArrayBuffer); the runtime accepts them.
  return nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase);
}

describe("PersonaStore", () => {
  it("applies persona.001 once and keeps rows", () => {
    const db = fresh();
    const first = new PersonaStore(db, fixedClock(1), silentLogger);
    first.write("a.md", "keep");
    const second = new PersonaStore(db, fixedClock(2), silentLogger);
    expect(second.read("a.md")).toBe("keep");
    expect(db.exec<{ id: string }>("SELECT id FROM brain_migration ORDER BY id").map((row) => row.id)).toEqual(["persona.001"]);
    const cols = db.exec<{ name: string; notnull: number; pk: number }>("PRAGMA table_info(persona_file)");
    const byName = new Map(cols.map((col) => [col.name, col]));
    expect([...byName.keys()]).toEqual(["name", "text", "updated_at"]);
    expect(byName.get("name")?.pk).toBe(1);
    expect(byName.get("text")?.notnull).toBe(1);
    expect(byName.get("updated_at")?.notnull).toBe(1);
  });

  it("writes, reads, lists in kernel order, and removes", () => {
    const clock = fixedClock(10);
    const store = new PersonaStore(fresh(), clock, silentLogger, "agent-1");
    store.write("ZZZ.md", "z");
    clock.set(20);
    store.write(fileSelf, "self-body");
    clock.set(30);
    store.write("AAA.md", "a");
    clock.set(40);
    store.write(filePersona, "persona-body");
    expect(store.read(filePersona)).toBe("persona-body");
    expect(store.read("missing.md")).toBeNull();
    expect(store.list()).toEqual([
      { name: filePersona, text: "persona-body", updatedAt: 40 },
      { name: fileSelf, text: "self-body", updatedAt: 20 },
      { name: "AAA.md", text: "a", updatedAt: 30 },
      { name: "ZZZ.md", text: "z", updatedAt: 10 },
    ]);
    clock.set(50);
    store.write(filePersona, "replaced");
    expect(store.read(filePersona)).toBe("replaced");
    expect(store.list()[0]).toEqual({ name: filePersona, text: "replaced", updatedAt: 50 });
    store.remove("AAA.md");
    expect(store.read("AAA.md")).toBeNull();
    store.remove("AAA.md");
    expect(store.list().map((row) => row.name)).toEqual([filePersona, fileSelf, "ZZZ.md"]);
    store.write("empty.md", "");
    expect(store.read("empty.md")).toBe("");
  });

  it("rejects a bad name and text over the cap", () => {
    const store = new PersonaStore(fresh(), fixedClock(1), silentLogger);
    for (const name of ["", "nope.txt", "../x.md", "a/b.md", ".md", "FILE.MD", "has space.md"]) {
      expect(() => {
        store.write(name, "x");
      }).toThrow(/name/);
    }
    expect(() => {
      store.remove("nope.txt");
    }).toThrow(/name/);
    expect(() => {
      store.write("big.md", "x".repeat(MAX_CHARS + 1));
    }).toThrow(/max/);
    store.write("edge.md", "y".repeat(MAX_CHARS));
    expect(store.read("edge.md")?.length).toBe(MAX_CHARS);

    const atCap = "é".repeat(MAX_CHARS / 2);
    const over = `${atCap}é`;
    expect(utf8Length(atCap)).toBe(MAX_CHARS);
    expect(over.length).toBeLessThan(MAX_CHARS);
    expect(utf8Length(over)).toBeGreaterThan(MAX_CHARS);
    store.write("fit.md", atCap);
    expect(store.read("fit.md")).toBe(atCap);
    expect(() => {
      store.write("over.md", over);
    }).toThrow(/max/);
    expect(store.read("over.md")).toBeNull();
    store.write("My.File-1.md", "ok");
    expect(store.read("My.File-1.md")).toBe("ok");
  });

  it("imports the legacy persona string once", () => {
    const db = fresh();
    const store = new PersonaStore(db, fixedClock(5), silentLogger);
    expect(store.importLegacy("")).toBe(false);
    expect(store.importLegacy("   ")).toBe(false);
    expect(store.list()).toEqual([]);
    expect(store.importLegacy("  kept\n")).toBe(true);
    expect(store.read(filePersona)).toBe("  kept\n");
    expect(store.read("persona.md")).toBeNull();
    expect(store.importLegacy("other")).toBe(false);
    expect(store.read(filePersona)).toBe("  kept\n");
    expect(assemblePersona(store.list())).toBe(assemblePersona([{ name: filePersona, text: "  kept\n" }]));

    const blocked = new PersonaStore(fresh(), fixedClock(1), silentLogger);
    blocked.write("notes.md", "n");
    expect(blocked.importLegacy("persona text")).toBe(false);
    expect(blocked.read(filePersona)).toBeNull();
    expect(blocked.read("notes.md")).toBe("n");

    const huge = new PersonaStore(fresh(), fixedClock(1), silentLogger);
    expect(() => {
      huge.importLegacy("x".repeat(MAX_CHARS + 1));
    }).toThrow(/max/);
    expect(huge.list()).toEqual([]);
    expect(huge.importLegacy("later")).toBe(true);
    expect(huge.read(filePersona)).toBe("later");
  });

  it("assembles store rows the same way as the part list", () => {
    const parts = [
      { name: "ZZZ.md", text: "extra-z" },
      { name: filePersona, text: "persona-body" },
      { name: fileSelf, text: "self-body" },
      { name: "SOUL.md", text: "soul-leftover" },
      { name: "AAA.md", text: "extra-a" },
    ];
    const old = assemblePersona(parts);
    const store = new PersonaStore(fresh(), fixedClock(1), silentLogger);
    for (const part of [...parts].reverse()) {
      store.write(part.name, part.text);
    }
    expect(store.list().map((row) => row.name)).toEqual([...preferredOrder, "AAA.md", "SOUL.md", "ZZZ.md"]);
    expect(assemblePersona(store.list())).toBe(old);
  });
});
