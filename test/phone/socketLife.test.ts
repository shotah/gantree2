import { describe, expect, it } from "vitest";
import {
  mailboxRefusedAccess,
  shouldDropMailboxOnHide,
  shouldProbeMailbox,
  shouldReconnectMailbox,
  shouldRedialMailboxOnVisible,
} from "@/lib/phone/socketLife";

describe("mailbox socket life", () => {
  it("drops the phone socket when the thread is hidden", () => {
    expect(shouldDropMailboxOnHide("phone", "hidden")).toBe(true);
    expect(shouldDropMailboxOnHide("phone", "visible")).toBe(false);
    expect(shouldDropMailboxOnHide("crane", "hidden")).toBe(false);
  });

  it("redials the phone when the thread is visible so the queue can flush", () => {
    expect(shouldRedialMailboxOnVisible("phone", "visible")).toBe(true);
    expect(shouldRedialMailboxOnVisible("phone", "hidden")).toBe(false);
    expect(shouldRedialMailboxOnVisible("crane", "visible")).toBe(false);
  });

  it("does not reconnect a hidden phone", () => {
    expect(shouldReconnectMailbox({
      role: "phone",
      visibilityState: "hidden",
      stopped: false,
    })).toBe(false);
    expect(shouldReconnectMailbox({
      role: "phone",
      visibilityState: "visible",
      stopped: false,
    })).toBe(true);
    expect(shouldReconnectMailbox({
      role: "crane",
      visibilityState: "hidden",
      stopped: false,
    })).toBe(true);
    expect(shouldReconnectMailbox({
      role: "phone",
      visibilityState: "visible",
      stopped: true,
    })).toBe(false);
  });

  it("probes only a phone dial that never opened", () => {
    expect(shouldProbeMailbox({ role: "phone", opened: false, code: 1006 })).toBe(true);
    expect(shouldProbeMailbox({ role: "phone", opened: false })).toBe(true);
    expect(shouldProbeMailbox({ role: "phone", opened: true, code: 1006 })).toBe(false);
    expect(shouldProbeMailbox({ role: "phone", opened: false, code: 4403 })).toBe(false);
    expect(shouldProbeMailbox({ role: "phone", opened: false, code: 4401 })).toBe(false);
    expect(shouldProbeMailbox({ role: "crane", opened: false, code: 1006 })).toBe(false);
  });

  it("treats HTTP 403 as mailbox access refused", () => {
    expect(mailboxRefusedAccess(403)).toBe(true);
    expect(mailboxRefusedAccess(401)).toBe(false);
    expect(mailboxRefusedAccess(404)).toBe(false);
    expect(mailboxRefusedAccess(409)).toBe(false);
    expect(mailboxRefusedAccess(426)).toBe(false);
    expect(mailboxRefusedAccess(503)).toBe(false);
    expect(mailboxRefusedAccess(null)).toBe(false);
  });

  it("stops redialing a room that closed 4403 and keeps redialing after 4401 or a drop", () => {
    expect(shouldReconnectMailbox({
      role: "phone",
      visibilityState: "visible",
      stopped: false,
      code: 4403,
    })).toBe(false);
    expect(shouldReconnectMailbox({
      role: "phone",
      visibilityState: "visible",
      stopped: false,
      code: 4401,
    })).toBe(true);
    expect(shouldReconnectMailbox({
      role: "phone",
      visibilityState: "visible",
      stopped: false,
      code: 1006,
    })).toBe(true);
  });
});
