import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fixedClock } from "@/harness/core/clock";
import { silentLogger } from "@/harness/core/log";
import { nodeSql, type NodeDatabase } from "@/harness/core/sql";
import { footer, roleAssistant, roleUser, SessionStore, speakerAgent } from "@/harness/session";

function open(): SessionStore {
  return new SessionStore(nodeSql(new DatabaseSync(":memory:") as unknown as NodeDatabase), fixedClock(Date.parse("2026-08-17T16:22:00.000Z")), silentLogger, {
    maxMessages: 20,
    maxEstTokens: 8000,
  });
}

describe("talk state", () => {
  it("arms, bumps, clears, and keeps last speaker", async () => {
    const store = open();
    const id = "telegram:1:1";
    const missing = store.talkState(id);
    expect(missing.waitingForReply).toBe(false);
    expect(missing.lastSpeaker).toBe("");

    store.armWait(id);
    let st = store.talkState(id);
    expect(st.waitingForReply).toBe(true);
    expect(st.waitNudges).toBe(0);
    expect(st.lastSpeaker).toBe(speakerAgent);
    expect(st.waitSetAt).toBeGreaterThan(0);
    const line = footer(st);
    expect(line).not.toBe("");
    expect(line).not.toBe("[conversation] last_speaker=none waiting_for_reply=false wait_nudges=0");

    st = store.bumpWaitNudge(id);
    expect(st.waitNudges).toBe(1);
    expect(st.waitingForReply).toBe(true);

    store.clearWait(id);
    st = store.talkState(id);
    expect(st.waitingForReply).toBe(false);
    expect(st.waitNudges).toBe(0);
    expect(st.lastSpeaker).toBe(speakerAgent);

    st = store.bumpWaitNudge(id);
    expect(st.waitNudges).toBe(0);

    await store.append(id, { role: roleUser, content: "hey" }, { role: roleAssistant, content: "hi" });
    st = store.talkState(id);
    expect(st.lastSpeaker).toBe(speakerAgent);
  });

  it("has an empty footer for the zero state", () => {
    expect(footer({ lastSpeaker: "", waitingForReply: false, waitNudges: 0, waitSetAt: 0 })).toBe("");
  });

  it("refuses an empty session id on arm and no-ops clear", () => {
    const store = open();
    expect(() => {
      store.armWait("  ");
    }).toThrow(/empty session_id/);
    store.clearWait("  ");
    expect(store.talkState("  ")).toEqual({ lastSpeaker: "", waitingForReply: false, waitNudges: 0, waitSetAt: 0 });
  });
});
