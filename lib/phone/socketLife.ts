import type { Role } from "@/lib/chat/frame";

/** Android Chrome keeps the mailbox socket OPEN while the page is frozen. */
export function shouldDropMailboxOnHide(role: Role, visibilityState: string): boolean {
  return role === "phone" && visibilityState === "hidden";
}

/** Do not trust readyState=OPEN after a freeze — redial so the queue can flush. */
export function shouldRedialMailboxOnVisible(role: Role, visibilityState: string): boolean {
  return role === "phone" && visibilityState === "visible";
}

/** The room list dropped this person. Redialing only meets a 403; the session is still good. */
export const CLOSE_NOT_IN_ROOM = 4403;

/** Never opened: refused over HTTP or never arrived; the browser cannot tell which. */
export function shouldProbeMailbox(opts: { role: Role; opened: boolean; code?: number }): boolean {
  if (opts.role !== "phone" || opts.opened) {
    return false;
  }
  if (opts.code === CLOSE_NOT_IN_ROOM || opts.code === 4401) {
    return false;
  }
  return true;
}

/** Plain GET on the mailbox route: 403 means not on the room list. */
export function mailboxRefusedAccess(httpStatus: number | null): boolean {
  return httpStatus === 403;
}

export function shouldReconnectMailbox(opts: {
  role: Role;
  visibilityState: string;
  stopped: boolean;
  /** `CloseEvent.code`. */
  code?: number;
}): boolean {
  if (opts.stopped || opts.code === CLOSE_NOT_IN_ROOM) {
    return false;
  }
  if (shouldDropMailboxOnHide(opts.role, opts.visibilityState)) {
    return false;
  }
  return true;
}
