/**
 * Prompt-only filler strip. SQLite is unchanged. Assistant turns stay verbatim
 * (they are the few-shot register). Negation, pronouns, and discourse particles
 * are not in the list — stripping them destroys meaning.
 */
import { keepRecentUnstripped, roleAssistant, type Message } from "./types";

const fillerWords = [
  "the", "a", "an",
  "of", "to", "in", "for", "on", "with", "at", "from", "by",
  "is", "are", "was", "were", "am", "be", "been", "being",
  "and", "or",
  "actually", "basically", "essentially", "generally",
  "currently", "simply",
  "um", "uh",
];

/** Longer first so "kind of" wins over a later single-word pass. */
const fillerPhrases = [
  "as well",
  "you know",
  "i mean",
  "kind of",
  "sort of",
];

const fillerRe = new RegExp(`\\b(?:${fillerWords.join("|")})\\b`, "gi");
const phraseRe = new RegExp(`\\b(?:${fillerPhrases.join("|")})\\b`, "gi");

function replaceFillers(chunk: string): string {
  phraseRe.lastIndex = 0;
  fillerRe.lastIndex = 0;
  return chunk.replace(phraseRe, " ").replace(fillerRe, " ");
}

/**
 * Removes filler phrases then filler words outside double quotes.
 * An unclosed quote keeps the rest of the string verbatim.
 */
export function stripFillerWords(s: string): string {
  if (s === "") {
    return s;
  }
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\"") {
      const end = s.indexOf("\"", i + 1);
      if (end < 0) {
        out += s.slice(i);
        break;
      }
      out += s.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const next = s.indexOf("\"", i);
    const chunk = next < 0 ? s.slice(i) : s.slice(i, next);
    out += replaceFillers(chunk);
    if (next < 0) {
      break;
    }
    i = next;
  }
  return out.replace(/\s+/gu, " ").trim();
}

/**
 * Copies `msgs` and strips fillers from older user turns. The last
 * `keepRecentUnstripped` messages stay verbatim. A short session is returned
 * as the same array.
 */
export function stripFillerHistory(msgs: readonly Message[]): Message[] {
  if (msgs.length <= keepRecentUnstripped) {
    return msgs as Message[];
  }
  const out = msgs.map((m) => ({ ...m }));
  const cut = out.length - keepRecentUnstripped;
  for (let i = 0; i < cut; i++) {
    const msg = out[i];
    if (!msg || msg.role === roleAssistant) {
      continue;
    }
    out[i] = { ...msg, content: stripFillerWords(msg.content) };
  }
  return out;
}
