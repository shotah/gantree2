import { describe, expect, it } from "vitest";
import {
  emptyReply,
  exceptSender,
  persistInboundForPhone,
  persistRole,
  phoneKindAllowed,
  resolvePhoneKind,
  routeTag,
  siblingPhoneTag,
} from "@/lib/chat/route";
import { shouldTranscript } from "@/lib/chat/transcript";
import type { WireFrame } from "@/lib/chat/frame";

describe("route", () => {
  it("sends reply to that user's sockets only", () => {
    expect(routeTag("crane", { kind: "reply", user_id: "ada" })).toBe("sub:ada");
    expect(routeTag("crane", { kind: "reply" })).toBeUndefined();
    expect(routeTag("crane", { kind: "typing", user_id: "ada" })).toBe("sub:ada");
    expect(routeTag("crane", { kind: "typing" })).toBeUndefined();
    expect(routeTag("crane", { kind: "draft", user_id: "ada" })).toBe("sub:ada");
    expect(routeTag("crane", { kind: "draft" })).toBeUndefined();
    expect(routeTag("crane", { kind: "error", user_id: "ada" })).toBe("sub:ada");
    expect(routeTag("crane", { kind: "error" })).toBe("role:phone");
  });

  it("broadcasts push with no user_id and targets push with user_id", () => {
    expect(routeTag("crane", { kind: "push" })).toBe("role:phone");
    expect(routeTag("crane", { kind: "push", user_id: "ada" })).toBe("sub:ada");
  });

  it("sends phone frames to crane", () => {
    expect(routeTag("phone", { kind: "inbound", text: "hi" })).toBe("role:crane");
    expect(routeTag("phone", { kind: "pin" })).toBe("role:crane");
    expect(routeTag("phone", { kind: "ack", id: "1" })).toBe("role:crane");
  });

  it("does not collide user_id with role or verified tags", () => {
    expect(routeTag("crane", { kind: "reply", user_id: "1" })).toBe("sub:1");
    expect(routeTag("crane", { kind: "reply", user_id: "phone" })).toBe("sub:phone");
    expect(routeTag("crane", { kind: "reply", user_id: "crane" })).toBe("sub:crane");
  });

  it("allows inbound pin ack from the phone and rejects crane kinds", () => {
    expect(resolvePhoneKind({ kind: "inbound" })).toBe("inbound");
    expect(resolvePhoneKind({ kind: "pin" })).toBe("pin");
    expect(resolvePhoneKind({ kind: "ack" })).toBe("ack");
    expect(resolvePhoneKind({ text: "hi" })).toBe("inbound");
    expect(resolvePhoneKind({ images: [{ url: "data:image/jpeg;base64,aa" }] })).toBe("inbound");
    expect(resolvePhoneKind({ context: { geo: { lat: 1, lon: 2 } } })).toBe("pin");
    expect(phoneKindAllowed({})).toBe(false);
    const banned: WireFrame[] = [
      { kind: "reply" },
      { kind: "push" },
      { kind: "error" },
      { kind: "cmds" },
      { kind: "typing" },
      { kind: "draft" },
    ];
    for (const frame of banned) {
      expect(phoneKindAllowed(frame)).toBe(false);
      expect(resolvePhoneKind(frame)).toBeUndefined();
    }
  });

  it("persists phone-bound reply/push and skips pin", () => {
    expect(persistRole("crane", "reply", "ada")).toBe("phone");
    expect(persistRole("crane", "reply")).toBeUndefined();
    expect(persistRole("crane", "push")).toBe("phone");
    expect(persistRole("crane", "error", "ada")).toBe("phone");
    expect(persistRole("phone", "inbound")).toBe("crane");
    expect(persistRole("phone", "pin")).toBeUndefined();
    expect(persistRole("phone", "ack")).toBeUndefined();
    expect(persistRole("crane", "typing", "ada")).toBeUndefined();
    expect(persistRole("crane", "draft", "ada")).toBeUndefined();
  });

  it("mirrors inbound onto the phone queue; transcript is the reload thread", () => {
    expect(persistInboundForPhone("phone", "inbound")).toBe(true);
    expect(persistInboundForPhone("phone", "pin")).toBe(false);
    expect(persistInboundForPhone("phone", "ack")).toBe(false);
    expect(persistInboundForPhone("crane", "inbound")).toBe(false);
    expect(persistInboundForPhone("crane", "reply")).toBe(false);
    expect(shouldTranscript("inbound")).toBe(true);
    expect(shouldTranscript("error")).toBe(false);
  });

  it("fans inbound to Ada's other sockets, not Bob and not a pin", () => {
    expect(siblingPhoneTag("phone", "inbound", "ada")).toBe("sub:ada");
    expect(siblingPhoneTag("phone", "inbound", "  ")).toBeUndefined();
    expect(siblingPhoneTag("phone", "pin", "ada")).toBeUndefined();
    expect(siblingPhoneTag("phone", "ack", "ada")).toBeUndefined();
    expect(siblingPhoneTag("crane", "inbound", "ada")).toBeUndefined();
    const ada = { id: "pwa" };
    const cab = { id: "cab" };
    const bob = { id: "bob" };
    expect(exceptSender([ada, cab, bob], ada)).toEqual([cab, bob]);
    expect(exceptSender([ada], ada)).toEqual([]);
  });

  it("calls a reply empty only when it has neither words nor a photo", () => {
    expect(emptyReply({ kind: "reply" })).toBe(true);
    expect(emptyReply({ kind: "reply", text: "  " })).toBe(true);
    expect(emptyReply({ kind: "reply", text: "rain" })).toBe(false);
    expect(emptyReply({ kind: "reply", images: [{ url: "https://cdn.example/a.jpg" }] })).toBe(false);
    expect(emptyReply({ kind: "push" })).toBe(false);
    expect(emptyReply({ kind: "error" })).toBe(false);
  });
});
