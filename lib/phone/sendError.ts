import type { PhotoErr } from "./photo";

/**
 * Mailbox `kind: "error"` frames carry a short wire token in `text` (`rate`, `too large`,
 * `bad frame`). Both mouths switch on the token and paint a sentence under the bubble
 * (Cab: `mailbox/SendError.kt`).
 */
export function describeSendError(text: string | undefined): string {
  switch (text?.trim().toLowerCase()) {
    case "rate":
      return "Not sent — too much too fast. Wait a minute, then try again.";
    case "too large":
      return "Not sent — too big for the room.";
    default:
      return "Not sent.";
  }
}

/** Photo failed before the wire: the shrink ladder bottomed out, or the decoder gave up. */
export function describePhotoError(error: PhotoErr["error"]): string {
  return error === "too large"
    ? "Photo not sent — still too big after shrinking."
    : "Photo not sent — couldn't read that image.";
}
