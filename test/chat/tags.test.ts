import { describe, expect, it } from "vitest";
import {
  collectTagged,
  fanOut,
  isSocketOpen,
  parseSocketTags,
  queueForAgent,
  roleTag,
  socketTags,
  subTag,
  tagAliases,
} from "@/lib/chat/tags";

function socket(readyState: number, fail = false) {
  const sent: string[] = [];
  return {
    readyState,
    sent,
    send(body: string) {
      if (fail) {
        throw new TypeError("Can't call WebSocket send() after close().");
      }
      sent.push(body);
    },
  };
}

describe("socket tags", () => {
  it("prefixes every slot so user_id cannot match role or verified", () => {
    expect(socketTags({
      role: "phone",
      rateId: "sub:1182",
      userId: "1",
      expMs: 9,
      email: "ada@example.com",
      emailVerified: true,
    })).toEqual([
      "role:phone",
      "rate:sub:1182",
      "sub:1",
      "exp:9",
      "email:ada@example.com",
      "verified:1",
    ]);
    expect(parseSocketTags(socketTags({
      role: "phone",
      rateId: "anon",
      userId: "1",
      emailVerified: true,
    }))).toMatchObject({
      role: "phone",
      rateId: "anon",
      userId: "1",
      expMs: undefined,
      email: undefined,
      emailVerified: true,
    });
  });

  it("still reads leftover positional tags from before the prefix", () => {
    expect(parseSocketTags(["phone", "anon", "1182", "9", "ada@example.com", "1"])).toEqual({
      role: "phone",
      rateId: "anon",
      userId: "1182",
      expMs: 9,
      email: "ada@example.com",
      emailVerified: true,
    });
  });

  it("looks up both prefixed and leftover names", () => {
    expect(tagAliases(roleTag("phone"))).toEqual(["role:phone", "phone"]);
    expect(tagAliases(subTag("ada"))).toEqual(["sub:ada", "ada"]);
    const sockets = {
      "role:phone": [{ readyState: 1 }],
      phone: [{ readyState: 1 }, { readyState: 0 }],
    };
    expect(collectTagged((tag) => sockets[tag as keyof typeof sockets] ?? [], roleTag("phone"))).toHaveLength(3);
    expect(isSocketOpen({ readyState: 1 })).toBe(true);
    expect(isSocketOpen({ readyState: 0 })).toBe(false);
    expect(queueForAgent(0)).toBe(true);
    expect(queueForAgent(1)).toBe(false);
  });

  it("fans past closing and throwing sockets and reports who took it", () => {
    const closing = socket(2);
    const throwing = socket(1, true);
    const live = socket(1);
    const took = fanOut([closing, throwing, live], "{}");
    expect(took).toEqual([live]);
    expect(live.sent).toEqual(["{}"]);
    expect(closing.sent).toEqual([]);
    expect(fanOut([], "{}")).toEqual([]);
  });
});
