import { KindExamplesPing, KindFollowUp, MaxWaitNudges, SilentToken } from "@/brain/cron/constants";
import { DailyPlannerPrefix, FollowUpTurnMarker } from "@/brain/cron/prompts";
import { advanceNext } from "@/brain/cron/schedule";
import { onceParsed } from "@/brain/cron/spread";
import { formatCronTime } from "@/brain/cron/time";
import { Runner } from "@/brain/cron/runner";
import { followUpPrefix, hasNoWaitToken, hasWaitToken, isFollowUpTurn, stripWaitTokens, stripWaitTokensLive } from "@/brain/cron/wait";
import { WaitService } from "@/brain/cron/waitctl";
import { describe, expect, it } from "vitest";
import { countKind, fakeTalk, openCron } from "./fixture";

describe("wait tokens", () => {
  it("detects and strips [wait] and [nowait]", () => {
    const cases: { in: string; wait: boolean; nowait: boolean; stripped: string }[] = [
      { in: "Thai or pizza?\n[wait]", wait: true, nowait: false, stripped: "Thai or pizza?" },
      { in: "Thai or pizza? [wait]", wait: true, nowait: false, stripped: "Thai or pizza?" },
      { in: "[WAIT]\nhello", wait: true, nowait: false, stripped: "hello" },
      { in: "I'll stop asking\n[nowait]", wait: false, nowait: true, stripped: "I'll stop asking" },
      { in: "hello", wait: false, nowait: false, stripped: "hello" },
      { in: "[silent]\n[wait]", wait: true, nowait: false, stripped: "[silent]" },
    ];
    for (const tc of cases) {
      expect(hasWaitToken(tc.in), tc.in).toBe(tc.wait);
      expect(hasNoWaitToken(tc.in), tc.in).toBe(tc.nowait);
      expect(stripWaitTokens(tc.in), tc.in).toBe(tc.stripped);
    }
  });

  it("hides a trailing incomplete wait token and recognizes follow-up turns", () => {
    const cases: { in: string; want: string }[] = [
      { in: "Thai or pizza?\n[wait]", want: "Thai or pizza?" },
      { in: "Thai or pizza?\n[wai", want: "Thai or pizza?" },
      { in: "Thai or pizza? [wai", want: "Thai or pizza?" },
      { in: "Thai or pizza? [wait]", want: "Thai or pizza?" },
      { in: "dropping it\n[nowait]", want: "dropping it" },
      { in: "dropping it\n[nowai", want: "dropping it" },
      { in: "hello", want: "hello" },
      { in: "[", want: "" },
    ];
    for (const tc of cases) expect(stripWaitTokensLive(tc.in), JSON.stringify(tc.in)).toBe(tc.want);
    expect(isFollowUpTurn(`${followUpPrefix(0, 2)}body`)).toBe(true);
    expect(isFollowUpTurn(DailyPlannerPrefix)).toBe(false);
  });
});

describe("wait service", () => {
  it("arms on [wait] and clears when the human talks", async () => {
    const { store } = openCron();
    const talk = fakeTalk();
    const wait = new WaitService({ talk, jobs: store, zone: "UTC" });
    const delivery = { sessionId: "s", userId: "u", chatId: "1" };
    await wait.afterReply(delivery, "hey", "Thai tonight?\n[wait]");
    const armed = await talk.talkState(delivery.sessionId);
    expect(armed.waitingForReply).toBe(true);
    expect(armed.waitNudges).toBe(0);
    expect(countKind(store, KindFollowUp)).toBe(1);

    await wait.afterReply(delivery, `${followUpPrefix(0, 2)}x`, "still there?\n[wait]");
    const still = await talk.talkState(delivery.sessionId);
    expect(still.waitNudges).toBe(0);

    await wait.onUserTurn(delivery.sessionId);
    const cleared = await talk.talkState(delivery.sessionId);
    expect(cleared.waitingForReply).toBe(false);
    expect(countKind(store, KindFollowUp)).toBe(0);
  });

  it("does not arm on a silent reply", async () => {
    const { store } = openCron();
    const talk = fakeTalk();
    const wait = new WaitService({ talk, jobs: store, zone: "UTC" });
    await wait.afterReply({ sessionId: "s" }, "hey", `${SilentToken}\n[wait]`);
    expect((await talk.talkState("s")).waitingForReply).toBe(false);
  });

  it("clears on [nowait]", async () => {
    const { store } = openCron();
    const talk = fakeTalk();
    const wait = new WaitService({ talk, jobs: store, zone: "UTC" });
    const delivery = { sessionId: "s", userId: "u" };
    await wait.afterReply(delivery, "hey", "ask?\n[wait]");
    await wait.afterReply(delivery, "hey", "dropping it\n[nowait]");
    expect((await talk.talkState(delivery.sessionId)).waitingForReply).toBe(false);
    expect(countKind(store, KindFollowUp)).toBe(0);
  });
});

describe("follow-up runner", () => {
  it("pokes twice and then stops", async () => {
    const { store, clock } = openCron();
    const talk = fakeTalk();
    const delivery = { sessionId: "s", userId: "u", chatId: "1" };
    await talk.armWait(delivery.sessionId);
    store.scheduleFollowUp(delivery, "UTC", clock.now() - 1000);
    const handled: string[] = [];
    const pushes: string[] = [];
    const runner = new Runner({
      store,
      talk,
      push: (msg) => {
        pushes.push(msg.text);
      },
    });
    await runner.fireDue(clock.now(), (turn) => {
      handled.push(turn.text);
      return "still thinking about dinner?";
    });
    expect(handled).toHaveLength(1);
    expect(handled[0]).toContain(FollowUpTurnMarker);
    expect(handled[0]).toContain("nudge 1 of 2");
    expect(pushes).toHaveLength(1);
    const after = await talk.talkState(delivery.sessionId);
    expect(after.waitNudges).toBe(1);
    expect(after.waitingForReply).toBe(true);
    expect(countKind(store, KindFollowUp)).toBe(1);

    const next = store.list(false).find((job) => job.kind === KindFollowUp);
    expect(next).toBeTruthy();
    store.sql.exec(
      "UPDATE cron_job SET next_run_at = ? WHERE id = ?",
      formatCronTime(clock.now() - 1000),
      next?.id ?? 0,
    );
    await runner.fireDue(clock.now(), (turn) => {
      handled.push(turn.text);
      return "still thinking about dinner?";
    });
    expect(handled).toHaveLength(2);
    const exhausted = await talk.talkState(delivery.sessionId);
    expect(exhausted.waitNudges).toBe(MaxWaitNudges);
    expect(exhausted.waitingForReply).toBe(true);
    expect(countKind(store, KindFollowUp)).toBe(0);
  });

  it("skips a follow-up when the human is not waiting", async () => {
    const { store, clock } = openCron();
    const talk = fakeTalk();
    store.scheduleFollowUp({ sessionId: "s", userId: "u", chatId: "1" }, "UTC", clock.now() - 1000);
    let called = 0;
    const runner = new Runner({
      store,
      talk,
      push: () => undefined,
    });
    await runner.fireDue(clock.now(), () => {
      called += 1;
      return "poke";
    });
    expect(called).toBe(0);
  });

  it("skips an examples ping while a wait campaign is active", async () => {
    const { store, clock } = openCron();
    const talk = fakeTalk();
    const delivery = { sessionId: "s", userId: "u", chatId: "1" };
    await talk.armWait(delivery.sessionId);
    store.schedule("example body", onceParsed(KindExamplesPing, clock.now() - 1000, "UTC"), delivery);
    let called = 0;
    const runner = new Runner({ store, talk, push: () => undefined });
    await runner.fireDue(clock.now(), () => {
      called += 1;
      return "example";
    });
    expect(called).toBe(0);
  });

  it("does not repeat a follow-up", () => {
    const from = Date.now();
    expect(advanceNext(KindFollowUp, new Date(from).toISOString(), "UTC", from).ok).toBe(false);
  });
});
