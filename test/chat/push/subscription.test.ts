import { describe, expect, it } from "vitest";
import { encodeBase64Url } from "@/lib/chat/push/vapid";
import {
  dropPush,
  endpointHash,
  parseHttpsEndpoint,
  parsePushDelete,
  parsePushPut,
  parsePushSub,
  parsePushTest,
  prunePushForRoom,
  PUSH_PER_USER,
  pushStoreKey,
  upsertPush,
  type StoredPush,
} from "@/lib/chat/push/subscription";

function fakeSub(n: number): PushSubFixture {
  const pub = new Uint8Array(65);
  pub[0] = 0x04;
  pub[1] = n;
  const auth = new Uint8Array(16);
  auth[0] = n;
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/sub-${n}`,
    keys: { p256dh: encodeBase64Url(pub), auth: encodeBase64Url(auth) },
  };
}

type PushSubFixture = { endpoint: string; keys: { p256dh: string; auth: string } };

describe("push subscription", () => {
  it("accepts an https endpoint with P-256 + 16-byte auth", () => {
    const sub = fakeSub(1);
    expect(parsePushSub(sub)).toEqual(sub);
    expect(parseHttpsEndpoint("http://fcm.googleapis.com/x")).toBeNull();
    expect(parseHttpsEndpoint("https://fcm.googleapis.com/x")).toBe("https://fcm.googleapis.com/x");
    expect(parseHttpsEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(
      "https://updates.push.services.mozilla.com/wpush/v2/x",
    );
    expect(parseHttpsEndpoint("https://evil.example/push")).toBeNull();
    expect(parseHttpsEndpoint("https://fcm.googleapis.com.evil.example/x")).toBeNull();
    expect(parseHttpsEndpoint("https://user:pass@fcm.googleapis.com/x")).toBeNull();
    expect(parseHttpsEndpoint("not a url")).toBeNull();
    expect(parsePushSub({ endpoint: sub.endpoint, keys: { p256dh: "aa", auth: sub.keys.auth } })).toBeNull();
  });

  it("parses put and delete bodies with a crane slug", () => {
    const sub = fakeSub(2);
    expect(parsePushPut({ slug: "Kit", subscription: sub })).toEqual({ slug: "kit", subscription: sub });
    expect(parsePushPut({ slug: "nope!", subscription: sub })).toBeNull();
    expect(parsePushDelete({ slug: "kit", endpoint: sub.endpoint })).toEqual({
      slug: "kit",
      endpoint: sub.endpoint,
    });
    expect(parsePushDelete({ slug: "kit" })).toBeNull();
    expect(parsePushTest({ slug: "Kit" })).toEqual({ slug: "kit" });
    expect(parsePushTest({ slug: "nope!" })).toBeNull();
    expect(parsePushTest({})).toBeNull();
    expect(parsePushTest(null)).toBeNull();
  });

  it("caps devices per human and drops a yanked room member", () => {
    const rows: StoredPush[] = [];
    let all: StoredPush[] = [];
    for (let i = 0; i < PUSH_PER_USER + 2; i++) {
      const row: StoredPush = {
        userId: "1182",
        email: "ada@example.com",
        emailVerified: true,
        subscription: fakeSub(i + 1),
        at: i,
      };
      all = upsertPush(all, row);
      rows.push(row);
    }
    expect(all).toHaveLength(PUSH_PER_USER);
    expect(all[0]?.subscription.endpoint).toBe(rows[2]?.subscription.endpoint);
    const replaced = upsertPush(all, {
      userId: "1182",
      subscription: fakeSub(3),
      at: 99,
    });
    expect(replaced.filter((p) => p.subscription.endpoint === fakeSub(3).endpoint)).toHaveLength(1);
    expect(dropPush(replaced, "1182", fakeSub(3).endpoint).some((p) => p.subscription.endpoint === fakeSub(3).endpoint)).toBe(false);
    const kept = prunePushForRoom(replaced, [{ email: "bob@example.com" }]);
    expect(kept).toEqual([]);
    expect(prunePushForRoom(replaced, [{ sub: "1182" }]).length).toBeGreaterThan(0);
    expect(pushStoreKey("1182", fakeSub(1).endpoint).startsWith("p:1182:")).toBe(true);
    expect(endpointHash("https://a")).not.toBe(endpointHash("https://b"));
  });
});
