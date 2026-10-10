import { describe, expect, it } from "vitest";
import {
  decodeBase64Url,
  encodeBase64Url,
  generateVapidKeys,
  parseVapidPrivate,
  parseVapidSubject,
  readVapid,
  vapidPublicKeyBytes,
  VAPID_SUBJECT_DEFAULT,
} from "@/lib/chat/push/vapid";

describe("vapid", () => {
  it("round-trips base64url and rejects a truncated public key", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(Array.from(decodeBase64Url(encodeBase64Url(bytes)) ?? [])).toEqual([1, 2, 3, 4]);
    expect(decodeBase64Url("")).toBeNull();
    expect(decodeBase64Url("!!!!")).toBeNull();
    expect(vapidPublicKeyBytes("aaaa")).toBeNull();
  });

  it("reads a generated key pair and defaults the contact URL", async () => {
    const keys = await generateVapidKeys();
    const pub = vapidPublicKeyBytes(keys.publicKey);
    expect(pub?.byteLength).toBe(65);
    expect(pub?.[0]).toBe(0x04);
    const env = {
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: JSON.stringify(keys.privateJwk),
    };
    const creds = readVapid(env);
    expect(creds?.publicKey).toBe(keys.publicKey);
    expect(creds?.privateJwk.d).toBe(keys.privateJwk.d);
    expect(creds?.subject).toBe(VAPID_SUBJECT_DEFAULT);
    expect(readVapid({})).toBeNull();
    expect(readVapid({ VAPID_PUBLIC_KEY: keys.publicKey })).toBeNull();
    expect(parseVapidPrivate("{")).toBeNull();
    expect(parseVapidPrivate(JSON.stringify({ kty: "RSA" }))).toBeNull();
    expect(parseVapidSubject("mailto:ada@example.com")).toBe("mailto:ada@example.com");
    expect(parseVapidSubject("https://example.invalid/pendant")).toBe("https://example.invalid/pendant");
    expect(parseVapidSubject("not-a-url")).toBe(VAPID_SUBJECT_DEFAULT);
  });
});
