import { describe, expect, it } from "vitest";
import {
  ALLOW_USERS_MAX,
  allowHash,
  agentPublishedAllow,
  fetchRoomUsers,
  parseAllowUsers,
  parseStoredSlug,
  phoneMustNotPublishAllow,
} from "@/lib/chat/allow";

const ada = "118212345678901234567";

describe("allow frames", () => {
  it("only the crane may publish the room list", () => {
    expect(phoneMustNotPublishAllow("phone", "allow")).toBe(true);
    expect(phoneMustNotPublishAllow("crane", "allow")).toBe(false);
    expect(phoneMustNotPublishAllow("phone", "inbound")).toBe(false);
    expect(agentPublishedAllow("crane", "allow")).toBe(true);
    expect(agentPublishedAllow("phone", "allow")).toBe(false);
  });

  it("parses users and drops junk", () => {
    expect(parseAllowUsers(null)).toEqual([]);
    expect(parseAllowUsers([
      { sub: ada, email: "Ada@Example.com" },
      { email: "bob@example.com" },
      { sub: "nope" },
      { email: "not-an-email" },
      "nope",
      { sub: ada, email: "dup@example.com" },
    ])).toEqual([
      { sub: ada, email: "ada@example.com" },
      { email: "bob@example.com" },
    ]);
  });

  it("caps the list at 64", () => {
    const raw = Array.from({ length: ALLOW_USERS_MAX + 5 }, (_, i) => ({
      email: `u${i}@example.com`,
    }));
    expect(parseAllowUsers(raw)).toHaveLength(ALLOW_USERS_MAX);
  });

  it("loads a room list from the Durable Object stub", async () => {
    const users = [{ email: "ada@example.com" }];
    const got = await fetchRoomUsers({
      fetch: async () => Response.json({ users }),
    });
    expect(got).toEqual(users);
    expect(await fetchRoomUsers({
      fetch: async () => new Response("no", { status: 500 }),
    })).toEqual([]);
    expect(parseStoredSlug("kit")).toBe("kit");
    expect(parseStoredSlug("Nope!")).toBeNull();
    expect(allowHash([{ email: "ada@example.com" }])).toBe(allowHash([{ email: "ada@example.com" }]));
    expect(allowHash([{ email: "ada@example.com" }])).not.toBe(allowHash([]));
  });
});
