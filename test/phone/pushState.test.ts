import { describe, expect, it } from "vitest";
import {
  parsePushTestCounts,
  PushRegister,
  pushRegisterHint,
  PushTestFail,
  pushTestHint,
  sameServerKey,
} from "@/lib/phone/pushState";

describe("sameServerKey", () => {
  it("matches byte for byte and treats a missing key as different", () => {
    const want = new Uint8Array([4, 1, 2, 3]);
    expect(sameServerKey(new Uint8Array([4, 1, 2, 3]).buffer, want)).toBe(true);
    expect(sameServerKey(new Uint8Array([4, 1, 2, 9]).buffer, want)).toBe(false);
    expect(sameServerKey(new Uint8Array([4, 1, 2]).buffer, want)).toBe(false);
    expect(sameServerKey(null, want)).toBe(false);
    expect(sameServerKey(undefined, want)).toBe(false);
  });
});

describe("push hints", () => {
  it("names each register outcome", () => {
    expect(pushRegisterHint(PushRegister.Ok)).toBe("");
    expect(pushRegisterHint(PushRegister.NoPermission)).toMatch(/not granted/);
    expect(pushRegisterHint(PushRegister.NoPushApi)).toMatch(/no Web Push/);
    expect(pushRegisterHint(PushRegister.NoVapid)).toMatch(/VAPID/);
    expect(pushRegisterHint(PushRegister.Unauthorized)).toMatch(/Sign in/);
    expect(pushRegisterHint(PushRegister.Rejected)).toMatch(/refused/);
    expect(pushRegisterHint(PushRegister.Failed)).toMatch(/reach the Worker/);
  });

  it("reads the Worker's counts and tolerates junk", () => {
    expect(parsePushTestCounts({ rows: 2, ok: 1, gone: 0, fail: 1, statuses: [403, "x"] }))
      .toEqual({ rows: 2, ok: 1, gone: 0, fail: 1, statuses: [403] });
    expect(parsePushTestCounts({ rows: -1, ok: "2" })).toEqual({ rows: 0, ok: 0, gone: 0, fail: 0, statuses: [] });
    expect(parsePushTestCounts(null)).toBeUndefined();
    expect(parsePushTestCounts("nope")).toBeUndefined();
  });

  it("turns counts into the one line the Settings row shows", () => {
    expect(pushTestHint(PushTestFail.NoVapid)).toMatch(/Local toast only/);
    expect(pushTestHint(PushTestFail.Unauthorized)).toMatch(/Sign in/);
    expect(pushTestHint(PushTestFail.Failed)).toMatch(/reach the Worker/);
    expect(pushTestHint({ rows: 0, ok: 0, gone: 0, fail: 0, statuses: [] })).toMatch(/No lock-screen subscription/);
    expect(pushTestHint({ rows: 1, ok: 1, gone: 0, fail: 0, statuses: [] })).toMatch(/sent to 1 device\./);
    expect(pushTestHint({ rows: 3, ok: 2, gone: 1, fail: 0, statuses: [] })).toMatch(/sent to 2 devices\./);
    expect(pushTestHint({ rows: 1, ok: 0, gone: 1, fail: 0, statuses: [] })).toMatch(/expired/);
    expect(pushTestHint({ rows: 1, ok: 0, gone: 0, fail: 1, statuses: [403] })).toMatch(/VAPID keys do not match/);
    expect(pushTestHint({ rows: 1, ok: 0, gone: 0, fail: 1, statuses: [401] })).toMatch(/VAPID keys do not match/);
    expect(pushTestHint({ rows: 1, ok: 0, gone: 0, fail: 1, statuses: [413] })).toBe("Push service refused (413).");
    expect(pushTestHint({ rows: 1, ok: 0, gone: 0, fail: 1, statuses: [] })).toBe("Could not build the push.");
  });
});
