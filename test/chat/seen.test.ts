import { describe, expect, it } from "vitest";
import { parseFrame } from "@/lib/chat/frame";
import { bareAck, connectSeenAck, seenAckFor, seenAckForTurn } from "@/lib/chat/seen";

describe("seen acks", () => {
  it("parses `seen: true` on a frame and drops anything else", () => {
    const yes = parseFrame(JSON.stringify({ kind: "ack", since: "4", seen: true }));
    expect(yes.ok && yes.frame.seen).toBe(true);
    const no = parseFrame(JSON.stringify({ kind: "ack", since: "4", seen: "yes" }));
    expect(no.ok && no.frame.seen).toBeUndefined();
  });

  it("copies a phone's seen ack for its siblings, never a plain ack or a crane's", () => {
    expect(seenAckFor("phone", { kind: "ack", since: "4", seen: true }, "1182"))
      .toEqual({ kind: "ack", seen: true, user_id: "1182", since: "4" });
    expect(seenAckFor("phone", { kind: "ack", id: "r1", seen: true }, "1182"))
      .toEqual({ kind: "ack", seen: true, user_id: "1182", id: "r1" });
    expect(seenAckFor("phone", { kind: "ack", seen: true }, "1182"))
      .toEqual({ kind: "ack", seen: true, user_id: "1182" });
    expect(seenAckFor("phone", { kind: "ack", since: "4" }, "1182")).toBeUndefined();
    expect(seenAckFor("phone", { kind: "ack", seen: true }, "")).toBeUndefined();
    expect(seenAckFor("phone", { kind: "ack", seen: true }, undefined)).toBeUndefined();
    expect(seenAckFor("crane", { kind: "ack", seen: true }, "1182")).toBeUndefined();
    expect(seenAckFor("phone", { kind: "inbound", seen: true, text: "hi" }, "1182")).toBeUndefined();
  });

  it("knows a bare ack", () => {
    expect(bareAck({ kind: "ack", seen: true })).toBe(true);
    expect(bareAck({ kind: "ack", since: "1" })).toBe(false);
    expect(bareAck({ kind: "ack", id: "m1" })).toBe(false);
    expect(bareAck({ kind: "inbound" })).toBe(false);
  });

  it("builds the phone's connect ack and per-turn seen ack", () => {
    expect(connectSeenAck("9")).toEqual({ kind: "ack", since: "9", seen: true });
    expect(connectSeenAck(undefined)).toEqual({ kind: "ack", seen: true });
    expect(seenAckForTurn({ kind: "reply", id: "r1" }, true)).toEqual({ kind: "ack", id: "r1", seen: true });
    expect(seenAckForTurn({ kind: "push", id: "p1" }, true)).toEqual({ kind: "ack", id: "p1", seen: true });
    expect(seenAckForTurn({ kind: "reply", id: "r1" }, false)).toBeUndefined();
    expect(seenAckForTurn({ kind: "reply", id: "r1", replay: true }, true)).toBeUndefined();
    expect(seenAckForTurn({ kind: "reply" }, true)).toBeUndefined();
    expect(seenAckForTurn({ kind: "inbound", id: "m1" }, true)).toBeUndefined();
    expect(seenAckForTurn({ kind: "draft", id: "d" }, true)).toBeUndefined();
  });
});
