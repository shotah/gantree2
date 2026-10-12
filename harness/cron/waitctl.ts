import type { Store } from "./store";
import type { Delivery, TalkStore } from "./types";
import { hasNoWaitToken, hasWaitToken, isFollowUpTurn, nextFollowUpDelay } from "./wait";
import { isSilentReply } from "./silent";

export type WaitOptions = {
  talk: TalkStore | null;
  jobs: Store | null;
  zone: string;
};

export class WaitService {
  constructor(private readonly opts: WaitOptions) {}

  async onUserTurn(sessionId: string): Promise<void> {
    const sid = sessionId.trim();
    if (!sid) return;
    if (this.opts.talk) await this.opts.talk.clearWait(sid);
    if (this.opts.jobs) this.opts.jobs.cancelFollowUps(sid);
  }

  async afterReply(delivery: Delivery, userText: string, reply: string): Promise<void> {
    if (isSilentReply(reply)) return;
    if (hasNoWaitToken(reply)) {
      await this.onUserTurn(delivery.sessionId);
      return;
    }
    if (!hasWaitToken(reply) || isFollowUpTurn(userText)) return;
    if (!this.opts.talk) throw new Error("cron: wait service has no session store");
    await this.opts.talk.armWait(delivery.sessionId);
    if (!this.opts.jobs) return;
    this.opts.jobs.cancelFollowUps(delivery.sessionId);
    const delay = nextFollowUpDelay(0);
    if (delay == null) return;
    const tz = this.opts.zone.trim() || "UTC";
    this.opts.jobs.scheduleFollowUp(delivery, tz, this.opts.jobs.clock.now() + delay);
  }
}
