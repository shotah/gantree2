import type { Role } from "./frame";

/** Phone TTL after the last typing frame. Crane refresh is 4s. */
export const TYPING_TTL_MS = 6_000;

export function phoneMustNotPublishTyping(role: Role, kind?: string): boolean {
  return role === "phone" && kind === "typing";
}

export function agentPublishedTyping(role: Role, kind?: string): boolean {
  return role === "crane" && kind === "typing";
}

/** A real outbound from the crane ends the action. Ack is delivery, not Handle. */
export function clearsTyping(kind?: string): boolean {
  return kind === "reply" || kind === "push" || kind === "error";
}
