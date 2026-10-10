/** Stay glued to the latest bubble unless the reader has scrolled up. */
export const THREAD_PIN_PX = 64;

export function isPinnedToBottom(
  el: { scrollHeight: number; scrollTop: number; clientHeight: number },
  slop = THREAD_PIN_PX,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slop;
}

export function pinToBottom(el: { scrollHeight: number; scrollTop: number }): void {
  el.scrollTop = el.scrollHeight;
}
