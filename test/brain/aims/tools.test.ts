import { AIM_HISTORY, AIM_LOG, aimToolDefs, aimTools, callAim } from "@/brain/aims";
import { describe, expect, it } from "vitest";
import { LA, openFixture } from "./fixture";

describe("aim tools", () => {
  it("rejects a bad score and an unknown area without writing", () => {
    const { store, mem } = openFixture();
    mem.seed("climbing");
    expect(() => callAim(store, AIM_LOG, `{"what":"pizza","aims":{"climbing":4}}`)).toThrow(/must be/);
    expect(() => callAim(store, AIM_LOG, `{"what":"pizza","aims":{"weight":-2}}`))
      .toThrow(/unknown area "weight"/);
    expect(() => callAim(store, AIM_LOG, `{"what":"pizza","aims":{"weight":-2}}`)).toThrow(/climbing/);
    expect(store.history("", "", "", 10)).toEqual([]);
  });

  it("formats a history line the same way as the log", () => {
    const { store, mem } = openFixture();
    mem.seed("drinking", "weight", "climbing");
    const line = callAim(store, AIM_LOG, JSON.stringify({
      what: "team dinner: 3 beers and a burger",
      day: "2026-09-22",
      aims: { drinking: -2, weight: -1, climbing: -1 },
    }));
    expect(line).toContain("2026-09-22 team dinner: 3 beers and a burger — ");
    expect(line).toContain("drinking -2");
    expect(line).toContain("weight -1");
    expect(line).toContain("climbing -1");
    const got = callAim(store, AIM_HISTORY, JSON.stringify({ area: "drinking", from: "2026-09-22", to: "2026-09-22" }));
    expect(got).toBe(line);
    for (const def of aimToolDefs()) {
      expect(def.name).not.toBe("");
      expect(def.inputSchema.type).toBe("object");
    }
  });

  it("rejects ints that would truncate through 32 bits", () => {
    const { store, mem } = openFixture();
    mem.seed("climbing");
    expect(() => callAim(store, AIM_LOG, `{"what":"pizza","aims":{"climbing":4294967298}}`))
      .toThrow(/must be -3\.\.3/);
    expect(store.history("", "", "", 10)).toEqual([]);
    expect(() => callAim(store, AIM_HISTORY, `{"limit":3000000000}`)).toThrow(/bad limit/);
  });

  it("rewrites by event id", () => {
    const { store, mem } = openFixture(LA);
    mem.seed("weight");
    const line = callAim(store, AIM_LOG, `{"what":"team dinner","day":"2026-09-22","aims":{"weight":-2}}`);
    const id = line.slice(1, line.indexOf(" "));
    const got = callAim(store, AIM_LOG, JSON.stringify({ what: "team dinner", event: Number(id), aims: { weight: 0 } }));
    expect(got).toContain("weight 0");
    expect(got).not.toContain("weight -2");
  });

  it("returns a tool error the model can read", async () => {
    const { store, mem } = openFixture();
    mem.seed("climbing");
    const tool = aimTools(store).find((item) => item.name === AIM_LOG);
    expect(tool).toBeDefined();
    if (!tool) {
      return;
    }
    const result = await tool.call(
      { what: "pizza", aims: { climbing: 4 } },
      { userId: "", sessionId: "" },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toMatch(/must be -3\.\.3/);
  });
});
