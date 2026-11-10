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
const CLOSE_NOT_IN_ROOM = 4403;

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
