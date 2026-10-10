import type { Root } from "mdast";
import { toString as mdastText } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import stripMarkdown from "strip-markdown";
import { unified } from "unified";

/**
 * Chirp 3 HD takes 5 000 bytes per `text:synthesize`. Leave room for
 * multibyte punctuation and the JSON around it.
 */
export const SPEAK_BYTES_MAX = 4_000;

/** Same remark the bubble paints with; `strip-markdown` is just a different output. */
const strip = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(stripMarkdown, {
    remove: [
      ["code", () => ({ type: "text", value: "code" })],
      ["image", () => ({ type: "text", value: "photo" })],
      ["imageReference", () => ({ type: "text", value: "photo" })],
    ],
  });

/** Pictographs plus the joiners and skin tones that ride with them. A reader says "red heart" otherwise. */
const EMOJI = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200D|\uFE0F/gu;

/**
 * Markdown → words a TTS engine can say. Bold / italic / headings / links keep
 * their text; fenced code becomes "code", an image becomes "photo"; tables and
 * raw HTML are dropped; emoji are dropped. Paragraphs join on a newline so the
 * engine still hears a sentence boundary.
 */
export function speakable(markdown: string): string {
  const src = markdown.trim();
  if (!src) {
    return "";
  }
  const tree = strip.runSync(strip.parse(src));
  const parts = tree.children
    .map((node) => mdastText(node).replace(EMOJI, "").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  return parts.join("\n");
}

/**
 * Keep a long reply under the synth cap without cutting a sentence in half.
 * Falls back to a hard cut when one sentence is itself over the cap.
 */
export function clipForSpeech(text: string, maxBytes = SPEAK_BYTES_MAX): string {
  const enc = new TextEncoder();
  if (enc.encode(text).byteLength <= maxBytes) {
    return text;
  }
  let out = "";
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (enc.encode(next).byteLength > maxBytes) {
      break;
    }
    out = next;
  }
  if (out) {
    return out;
  }
  const bytes = enc.encode(text).slice(0, maxBytes);
  return new TextDecoder().decode(bytes).replace(/\uFFFD+$/, "");
}
