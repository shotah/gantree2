/** Bounded conversation history. System/persona turns are not stored. */

export const roleUser = "user";
export const roleAssistant = "assistant";

export const speakerUser = "user";
export const speakerAgent = "agent";

/** The one conversation id the harness collapsed every mouth into. */
export const agentSession = "gantry";

/** Trailing history messages that stay verbatim when fillers are stripped. */
export const keepRecentUnstripped = 40;

export const defaultMaxMessages = 200;
export const defaultMaxEstTokens = 32_000;

export type Message = {
  role: string;
  content: string;
};

/** Per-session conversation wait / last-speaker (not operator prefs). */
export type TalkState = {
  lastSpeaker: string;
  waitingForReply: boolean;
  waitNudges: number;
  /** ms epoch. `0` when no wait is armed. */
  waitSetAt: number;
};
