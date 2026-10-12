import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock } from "@/harness/core/clock";
import { silentLogger } from "@/harness/core/log";
import { nodeSql, type NodeDatabase } from "@/harness/core/sql";
import { formatPin, HereStore } from "@/harness/here";
import { agentSession } from "@/harness/session/types";

describe("here", () => {
  it("remembers a pin and formats the prompt line", () => {
    const at = Date.parse("2026-08-17T16:22:00.000Z");
    const store = new HereStore(nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase), fixedClock(at), silentLogger);
    const sid = "here-test-cache-1";
    store.remember(sid, { lat: 37.386051, lon: -122.083855, label: "Cafe", accuracyM: 12 }, at);
    const pin = store.get(sid);
    expect(pin).not.toBeNull();
    expect(pin?.label).toBe("Cafe");
    expect(pin?.accuracyM).toBe(12);
    const got = formatPin(pin ?? { lat: 0, lon: 0, label: "", accuracyM: 0, at: 0 }, at + 3 * 60_000, "America/Los_Angeles");
    expect(got).toContain("[location ±12m]");
    expect(got).toContain("37.386051");
    expect(got).toContain("3m ago");
    expect(got).toContain("Cafe");
    expect(got).not.toContain("[last pin]");
    expect(got).toContain("Mon Aug 17, 2026 4:22 PM UTC");
  });

  it("ignores a null geo, a zero timestamp, and a missing pin", () => {
    const store = new HereStore(nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase), fixedClock(1), silentLogger);
    store.remember("s", null, 1);
    store.remember("s", { lat: 1, lon: 2 }, 0);
    store.set("  ", { lat: 1, lon: 2, label: "", accuracyM: 0, at: 5 });
    expect(store.get("s")).toBeNull();
    expect(formatPin({ lat: 1, lon: 2, label: "", accuracyM: 0, at: 0 }, 5, "UTC")).toBe("");
    expect(store.format("s")).toBe("");
  });

  it("collapses leftover pins onto the agent session, keeping the newest", () => {
    const at = Date.parse("2026-08-17T16:22:00.000Z");
    const clock = fixedClock(at);
    const sql = nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase);
    const store = new HereStore(sql, clock, silentLogger);
    store.set("gantry", { lat: 1, lon: 2, label: "old", accuracyM: 0, at: at - 1000 });
    store.set("telegram:1", { lat: 3, lon: 4, label: "new", accuracyM: 8, at });
    const again = new HereStore(sql, clock, silentLogger);
    expect(again.get("gantry")).toBeNull();
    expect(again.get("telegram:1")).toBeNull();
    expect(again.get(agentSession)).toEqual({
      lat: 3,
      lon: 4,
      label: "new",
      accuracyM: 8,
      at,
    });
    expect(store.get(agentSession)?.label).toBe("new");
  });
});
