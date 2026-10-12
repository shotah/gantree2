import { NoWaitToken, WaitToken } from "./constants";
import { stripBareToken, stripReactTokens } from "./tokens";

/** Emoji inside the first `[react …]` token, or "" when the reply has none. */
export function reactEmoji(s: string): string {
  const waited = stripBareToken(s, WaitToken).text;
  const cleared = stripBareToken(waited, NoWaitToken).text;
  return stripReactTokens(cleared).emoji;
}

export function stripReact(s: string): string {
  return stripReactTokens(s).text;
}
