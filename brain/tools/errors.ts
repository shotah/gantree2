/**
 * Tool errors the model and the Tools grid both switch on.
 * Stable codes: `no_binary`, `no_key`, `no_oauth`, `connect`.
 * Plugin `ready()` may also report `disabled` or `error`.
 *
 * Skipped prefix: `tool error [<reason>]: <server> is skipped — do not invent <server>__* names`
 * Classified tool failure: `tool error [<reason>]: <text>`
 * Anything else: `tool error: <text>`
 */

const NOTE_MAX = 80;

const BINARY_NEEDLES = [
  "executable file not found",
  "not found in $path",
  "not found in %path%",
];

const KEY_NEEDLES = [
  "api key",
  "apikey",
  "missing env",
  "environment variable",
  "required env",
  "no key",
  "api_key",
];

const OAUTH_NEEDLES = [
  "oauth",
  "unauthenticated",
  "not authenticated",
  "login required",
  "authorize",
  "invalid_grant",
  "refresh token",
  "no token",
  "token expired",
  "401",
];

/** Map a free-text error to a stable code. Empty text is `connect`. */
export function classifyReason(message: string): string {
  const text = message.toLowerCase().trim();
  if (text === "") {
    return "connect";
  }
  if (BINARY_NEEDLES.some((needle) => text.includes(needle)) || looksLikeMissingBinary(text)) {
    return "no_binary";
  }
  if (KEY_NEEDLES.some((needle) => text.includes(needle))) {
    return "no_key";
  }
  if (OAUTH_NEEDLES.some((needle) => text.includes(needle))) {
    return "no_oauth";
  }
  return "connect";
}

/**
 * A connect failure is re-read against the note and stderr so
 * "API_KEY is required" stays `no_key` when the transport error itself
 * does not mention the key. A reason that is already specific is kept.
 */
export function driftReason(reason: string, note: string, stderr: string): string {
  const current = reason || "connect";
  if (current !== "connect") {
    return current;
  }
  const again = classifyReason(`${note}\n${stderr}`);
  return again === "connect" ? "connect" : again;
}

/** Model-facing text for a boot-skipped plugin. */
export function unavailableMessage(server: string, reason: string, note?: string): string {
  const code = reason || "connect";
  const clipped = clipNote(note ?? "");
  if (clipped) {
    return `tool error [${code}]: ${server} is skipped (${clipped}) — do not invent ${server}__* names`;
  }
  return `tool error [${code}]: ${server} is skipped — do not invent ${server}__* names`;
}

/**
 * Model-facing text for a tool failure. Key, oauth, and missing-binary
 * failures keep a bracketed reason. Everything else stays `tool error: …`.
 * Text that is already a `tool error` is not wrapped again.
 */
export function toolErrorText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("tool error")) {
    return trimmed;
  }
  const reason = classifyReason(trimmed);
  if (reason === "no_key" || reason === "no_oauth" || reason === "no_binary") {
    return `tool error [${reason}]: ${trimmed}`;
  }
  return `tool error: ${trimmed}`;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return "tool call failed";
}

/** First line, at most 80 code points, ellipsis when cut. */
export function clipNote(value: string): string {
  let note = value.trim();
  const newline = note.indexOf("\n");
  if (newline >= 0) {
    note = note.slice(0, newline);
  }
  const runes = Array.from(note);
  if (runes.length <= NOTE_MAX) {
    return note;
  }
  return `${runes.slice(0, NOTE_MAX - 1).join("")}…`;
}

function looksLikeMissingBinary(text: string): boolean {
  if (text.includes("no such file")) {
    return true;
  }
  return text.startsWith("exec:") && text.includes("not found");
}
