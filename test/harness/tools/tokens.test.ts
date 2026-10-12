import { describe, expect, it } from "vitest";
import { type OAuthToken } from "@/harness/core/tools";
import { AesTokenStore, decodeSnapshotKey } from "@/harness/tools/tokens";
import { memSql, testClock } from "./fixture";

const TOKEN: OAuthToken = {
  accessToken: "super-secret-access-token-value",
  refreshToken: "refresh-me",
  expiresAt: 1_800_000_000_000,
  scope: "activity:read",
  tokenType: "Bearer",
  extra: { athlete: "9" },
};

function rawKey(): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = i + 1;
  }
  return bytes;
}

function b64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

describe("decodeSnapshotKey", () => {
  it("accepts 32 raw bytes and standard base64 of those bytes", () => {
    const bytes = rawKey();
    expect(decodeSnapshotKey(bytes)).toEqual(bytes);
    expect(decodeSnapshotKey(b64(bytes))).toEqual(bytes);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    expect(decodeSnapshotKey(buffer)).toEqual(bytes);
  });

  it("rejects a short key and a bad string", () => {
    expect(() => decodeSnapshotKey(new Uint8Array(31))).toThrow(/32 bytes/);
    expect(() => decodeSnapshotKey("not-a-key")).toThrow(/32 bytes/);
  });
});

describe("AesTokenStore", () => {
  it("round-trips plaintext and stores ciphertext", async () => {
    const sql = memSql();
    const clock = testClock();
    const key = rawKey();
    const store = new AesTokenStore(sql, key, clock);
    expect(await store.get("google")).toBeNull();
    await store.put("google", TOKEN);
    expect(await store.get("google")).toEqual(TOKEN);
    expect(sql.one<{ at: number }>("SELECT at FROM oauth_token WHERE provider = ?", "google")?.at).toBe(clock.now());

    const blob = sql.one<{ blob: Uint8Array }>("SELECT blob FROM oauth_token WHERE provider = ?", "google")?.blob;
    expect(blob).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(blob)).not.toContain(TOKEN.accessToken);

    clock.tick(1000);
    await store.put(" google ", { accessToken: "next" });
    expect(await store.get("google")).toEqual({ accessToken: "next" });
    expect(sql.one<{ at: number }>("SELECT at FROM oauth_token WHERE provider = ?", "google")?.at).toBe(clock.now());

    await store.put("strava", { accessToken: "ride" });
    expect(await store.get("strava")).toEqual({ accessToken: "ride" });
    await store.delete("strava");
    expect(await store.get("strava")).toBeNull();
    expect(await store.get("google")).toEqual({ accessToken: "next" });
  });

  it("decrypts with the base64 form of the same key and rejects a different key", async () => {
    const sql = memSql();
    const clock = testClock();
    const key = rawKey();
    await new AesTokenStore(sql, key, clock).put("google", TOKEN);
    expect(await new AesTokenStore(sql, b64(key), clock).get("google")).toEqual(TOKEN);
    const other = rawKey();
    other[0] = 9;
    await expect(new AesTokenStore(sql, other, clock).get("google")).rejects.toThrow(/decrypt failed/);
  });
});
