import { describe, expect, it } from "vitest";
import { makeLogger } from "@/harness/core/log";
import type { PluginContext } from "@/harness/core/tools";
import { allPlugins } from "@/harness/plugins";
import { grantedPlugins } from "@/harness/room/grants";
import { Registry } from "@/harness/tools";

const MATH = "[[server]]\nname = \"math\"\ncommand = \"math\"\n";

function ctx(): PluginContext {
  return {
    env: {},
    sql: { exec: () => [], one: () => null, changes: () => 0 },
    clock: { now: () => 0, zone: "UTC" },
    log: makeLogger(() => undefined, () => 0),
    fetch: globalThis.fetch,
    tokens: {
      get: () => Promise.resolve(null),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      list: async () => [],
    },
  };
}

describe("granted plugins", () => {
  it("publishes a granted plugin and drops it when the grant is revoked", async () => {
    const on = new Registry(grantedPlugins(allPlugins, MATH), ctx(), { dynamicTools: false, builtins: [] });
    const published = await on.publish();
    expect(published.published).toEqual(["math"]);
    expect(published.skipped.some((row) => row.name === "math")).toBe(false);
    expect(published.skipped.every((row) => row.reason === "disabled")).toBe(true);
    expect(on.list().map((tool) => tool.name)).toContain("math__expression_evaluate");

    const off = new Registry(grantedPlugins(allPlugins, ""), ctx(), { dynamicTools: false, builtins: [] });
    const revoked = await off.publish();
    expect(revoked.published).toEqual([]);
    expect(revoked.skipped).toContainEqual({ name: "math", reason: "disabled" });
    expect(off.list().some((tool) => tool.name.startsWith("math__"))).toBe(false);
  });
});
