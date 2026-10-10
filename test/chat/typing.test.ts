import { describe, expect, it } from "vitest";
import {
  TYPING_TTL_MS,
  clearsTyping,
  agentPublishedTyping,
  phoneMustNotPublishTyping,
} from "@/lib/chat/typing";

describe("typing frames", () => {
  it("only the crane may publish typing", () => {
    expect(phoneMustNotPublishTyping("phone", "typing")).toBe(true);
    expect(phoneMustNotPublishTyping("crane", "typing")).toBe(false);
    expect(phoneMustNotPublishTyping("phone", "inbound")).toBe(false);
    expect(agentPublishedTyping("crane", "typing")).toBe(true);
    expect(agentPublishedTyping("phone", "typing")).toBe(false);
  });

  it("clears on crane outbound, not on inbound ack", () => {
    expect(clearsTyping("reply")).toBe(true);
    expect(clearsTyping("push")).toBe(true);
    expect(clearsTyping("error")).toBe(true);
    expect(clearsTyping("ack")).toBe(false);
    expect(clearsTyping("typing")).toBe(false);
    expect(clearsTyping("draft")).toBe(false);
    expect(clearsTyping("inbound")).toBe(false);
  });

  it("keeps a TTL longer than the crane refresh", () => {
    expect(TYPING_TTL_MS).toBe(6_000);
  });
});
