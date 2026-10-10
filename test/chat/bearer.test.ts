import { describe, expect, it } from "vitest";
import { bearerForSlug, bearerMatches, fetchRoomBearer, parseBearers } from "@/lib/chat/bearer";

describe("bearer", () => {
  it("binds a token to one slug", () => {
    const map = parseBearers("kit:alpha,ada:beta, :skip,nocolon");
    expect(map.get("kit")).toBe("alpha");
    expect(bearerForSlug(map, "kit", "alpha")).toBe(true);
    expect(bearerForSlug(map, "ada", "alpha")).toBe(false);
    expect(bearerForSlug(map, "kit", "beta")).toBe(false);
    expect(bearerForSlug(map, "nope", "alpha")).toBe(false);
    expect(bearerForSlug(map, "kit", "")).toBe(false);
    expect(bearerMatches("alpha", "alpha")).toBe(true);
    expect(bearerMatches("", "alpha")).toBe(false);
    expect(bearerMatches("alpha", "")).toBe(false);
  });

  it("handles empty env", () => {
    expect(parseBearers("").size).toBe(0);
    expect(parseBearers(undefined).size).toBe(0);
  });

  it("reads the room row and treats a bad body as none", async () => {
    expect(await fetchRoomBearer({
      fetch: async () => Response.json({ bearer: "from-do" }),
    })).toBe("from-do");
    expect(await fetchRoomBearer({
      fetch: async () => Response.json({ bearer: "" }),
    })).toBeNull();
    expect(await fetchRoomBearer({
      fetch: async () => new Response("no", { status: 500 }),
    })).toBeNull();
    expect(await fetchRoomBearer({
      fetch: async () => Response.json(["nope"]),
    })).toBeNull();
    expect(await fetchRoomBearer({
      fetch: async () => {
        throw new Error("down");
      },
    })).toBeNull();
  });
});
