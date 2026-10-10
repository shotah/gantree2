import { describe, expect, it, vi } from "vitest";
import { agentStub, parseLocationHint } from "@/lib/chat/location";

describe("location hint", () => {
  it("accepts Cloudflare region tokens and drops junk", () => {
    expect(parseLocationHint("wnam")).toBe("wnam");
    expect(parseLocationHint(" ENAM ")).toBe("enam");
    expect(parseLocationHint("apac-se")).toBe("apac-se");
    expect(parseLocationHint("")).toBeUndefined();
    expect(parseLocationHint("us-west")).toBeUndefined();
    expect(parseLocationHint(undefined)).toBeUndefined();
  });

  it("passes the hint only when it is a known region", () => {
    const get = vi.fn(() => ({ fetch: vi.fn() }));
    const env = {
      AGENT: {
        idFromName: (name: string) => ({ name }) as unknown as DurableObjectId,
        get,
      } as unknown as DurableObjectNamespace,
      LOCATION_HINT: "wnam",
    };
    agentStub(env, "kit");
    expect(get).toHaveBeenCalledWith({ name: "kit" }, { locationHint: "wnam" });
    get.mockClear();
    agentStub({ ...env, LOCATION_HINT: "nope" }, "kit");
    expect(get).toHaveBeenCalledWith({ name: "kit" });
    expect(agentStub({ AGENT: undefined }, "kit")).toBeNull();
  });
});
