import { describe, expect, it } from "vitest";
import { FOLDS_KEY_PREFIX, foldsKey, readFolds, writeFold } from "@/app/lib/folds";

function memStorage(seed: Record<string, string> = {}) {
  const mem = new Map(Object.entries(seed));
  return {
    mem,
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => {
      mem.set(key, value);
    },
  };
}

describe("fold memory", () => {
  it("keys one map per page", () => {
    expect(foldsKey("agent")).toBe("gantree.folds.agent");
    expect(FOLDS_KEY_PREFIX).toBe("gantree.folds.");
  });

  it("reads only boolean entries and shrugs at junk", () => {
    expect(readFolds(null, "agent")).toEqual({});
    expect(readFolds(memStorage(), "agent")).toEqual({});
    expect(readFolds(memStorage({ "gantree.folds.agent": "not json" }), "agent")).toEqual({});
    expect(readFolds(memStorage({ "gantree.folds.agent": "[true]" }), "agent")).toEqual({});
    expect(readFolds(memStorage({ "gantree.folds.agent": '{"Status":false,"Log":"yes","Keys":true}' }), "agent")).toEqual({ Status: false, Keys: true });
    const throwing = {
      getItem: () => {
        throw new Error("private mode");
      },
    };
    expect(readFolds(throwing, "agent")).toEqual({});
  });

  it("merges one fold at a time and survives a storage that refuses writes", () => {
    const storage = memStorage();
    writeFold(storage, "agent", "Status", false);
    writeFold(storage, "agent", "Log", true);
    writeFold(storage, "settings", "Spend", false);
    expect(readFolds(storage, "agent")).toEqual({ Status: false, Log: true });
    expect(readFolds(storage, "settings")).toEqual({ Spend: false });
    writeFold(storage, "agent", "Status", true);
    expect(readFolds(storage, "agent")).toEqual({ Status: true, Log: true });
    writeFold(null, "agent", "Status", false);
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => writeFold(refusing, "agent", "Status", false)).not.toThrow();
  });
});
