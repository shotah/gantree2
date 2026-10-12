import { normalizeAPIPrefix } from "@/harness/plugins/chat/config";
import { bearerMatches } from "@/lib/chat/bearer";
import { bearerToken } from "@/lib/chat/session";

const slugRE = /^[a-z][a-z0-9-]{0,31}$/;

export function mailboxSocket(origin: string, slug: string): string | null {
  const slugNorm = slug.trim().toLowerCase();
  if (!slugRE.test(slugNorm)) {
    return null;
  }
  let base: URL;
  try {
    base = new URL(origin.trim());
  } catch {
    return null;
  }
  if (!base.host) {
    return null;
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    return null;
  }
  const hostOrigin = base.origin;
  if (base.protocol === "https:") {
    return `wss://${new URL(hostOrigin).host}/ws/${slugNorm}`;
  }
  return `ws://${new URL(hostOrigin).host}/ws/${slugNorm}`;
}

export function withChatMailbox(
  env: Record<string, string>,
  input: { origin: string; slug: string; bearer: string },
): Record<string, string> {
  const map = { ...env };
  const mailbox = (map.CHAT_MAILBOX_URL ?? "").trim();
  if (!mailbox) {
    const socket = mailboxSocket(input.origin, input.slug);
    if (socket) {
      map.CHAT_MAILBOX_URL = socket;
    }
  }
  const bearer = (map.CHAT_BEARER ?? "").trim();
  if (!bearer && input.bearer.trim()) {
    map.CHAT_BEARER = input.bearer.trim();
  }
  return map;
}

export function chatLoopbackFetch(
  base: typeof fetch,
  opts: {
    origin: string;
    slug: string;
    bearer: string;
    apiPrefix?: string;
    serve: (req: Request) => Promise<Response>;
  },
): typeof fetch {
  const prefix = normalizeAPIPrefix(opts.apiPrefix ?? "");
  const paths = new Set([`${prefix}/avatar`, `${prefix}/backdrop`, `${prefix}/theme`]);
  let wantOrigin = "";
  try {
    wantOrigin = new URL(opts.origin.trim()).origin;
  } catch {
    wantOrigin = "";
  }

  return function chatLoopback(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let url: URL;
    try {
      url = new URL(input instanceof Request ? input.url : String(input));
    } catch {
      return base.call(globalThis, input, init);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return base.call(globalThis, input, init);
    }
    if (!wantOrigin || url.origin !== wantOrigin) {
      return base.call(globalThis, input, init);
    }
    if (!paths.has(url.pathname)) {
      return base.call(globalThis, input, init);
    }
    if (url.searchParams.get("slug") !== opts.slug) {
      return base.call(globalThis, input, init);
    }
    const request = new Request(input, init);
    const presented = bearerToken(request.headers.get("Authorization")) ?? "";
    if (!bearerMatches(opts.bearer, presented)) {
      return Promise.resolve(Response.json({ error: "unauthorized" }, { status: 401 }));
    }
    return opts.serve(request);
  };
}
