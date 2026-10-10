import type { Role } from "./frame";

/** Browser Origin must match the request URL origin. Missing Origin (Go harness) is allowed. */
export function upgradeOriginOk(originHeader: string | null, urlOrigin: string): boolean {
  if (originHeader === null) {
    return true;
  }
  return originHeader === urlOrigin;
}

const STAMP_PREFIXES = ["x-chat-", "x-pendant-"];

/** Drop every `X-Chat-*` and leftover `X-Pendant-*` so a client cannot pre-set Sub / Email / Op / Exp. */
export function stripUpgradeOp(headers: Headers): void {
  const names: string[] = [];
  headers.forEach((_value, name) => {
    const lower = name.toLowerCase();
    if (STAMP_PREFIXES.some((p) => lower.startsWith(p))) {
      names.push(name);
    }
  });
  for (const name of names) {
    headers.delete(name);
  }
}

export type UpgradeStamp = {
  role: Role;
  rateId: string;
  slug: string;
  userId?: string;
  email?: string;
  emailVerified?: boolean;
  exp?: number;
};

/** Copy the upgrade request, strip client stamps, write the principal the Worker earned. */
export function stampAgentHeaders(request: Request, stamp: UpgradeStamp): Headers {
  const headers = new Headers(request.headers);
  stripUpgradeOp(headers);
  headers.set("X-Chat-Role", stamp.role);
  headers.set("X-Chat-Rate", stamp.rateId);
  headers.set("X-Chat-Slug", stamp.slug);
  if (stamp.userId) {
    headers.set("X-Chat-Sub", stamp.userId);
  }
  if (stamp.email) {
    headers.set("X-Chat-Email", stamp.email);
  }
  if (stamp.emailVerified) {
    headers.set("X-Chat-EmailVerified", "1");
  }
  if (stamp.exp != null) {
    headers.set("X-Chat-Exp", String(stamp.exp));
  }
  headers.delete("Authorization");
  return headers;
}
