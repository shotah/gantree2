import type { Role, WireFrame } from "@/lib/chat/frame";

export function mailboxUrl(opts: {
  host: string;
  protocol: string;
  slug: string;
  role: Role;
  secret?: string;
  bearer?: string;
}): string {
  const ws = opts.protocol === "https:" ? "wss:" : "ws:";
  const u = new URL(`${ws}//${opts.host}/ws/${opts.slug}`);
  u.searchParams.set("role", opts.role);
  // Spike /crane may put creds on the query; oidc handshake ignores them.
  if (opts.secret) {
    u.searchParams.set("secret", opts.secret);
  }
  if (opts.bearer) {
    u.searchParams.set("bearer", opts.bearer);
  }
  return u.toString();
}

export function parseIncoming(raw: string): WireFrame | null {
  try {
    const v = JSON.parse(raw) as WireFrame;
    if (!v || typeof v !== "object") {
      return null;
    }
    return v;
  } catch {
    return null;
  }
}
