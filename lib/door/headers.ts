/**
 * Security headers on every response the Worker produces. The policy's nonce
 * rides in on the request's `content-security-policy` header: Vinext reads it
 * there to stamp its own inline scripts (as Next.js does), and the layouts read
 * it through `scriptNonce` for theirs. Static assets never reach the Worker;
 * `public/_headers` covers them.
 */
import type { Fetcher } from "@/lib/chat/entry";
import { randomToken } from "./google";

const CSP = "content-security-policy";

/** Agent messages may carry remote `https:` images (`imageUrlAllowed` in lib/chat/frame.ts). */
export function contentSecurityPolicy(nonce: string, url: URL): string {
  const socket = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src 'self' ${socket}`,
    "media-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ");
}

/** The nonce the Worker put on this request, for a layout's own `<script>`. */
export function scriptNonce(headers: Headers): string | undefined {
  return /'nonce-([\w+/=-]+)'/.exec(headers.get(CSP) ?? "")?.[1];
}

/** `csp` is `null` in dev, where Vite's inline scripts and eval-based reload carry no nonce. */
export function secured(res: Response, url: URL, csp: string | null): Response {
  if (res.status === 101) {
    return res;
  }
  const out = new Response(res.body, res);
  out.headers.set("x-content-type-options", "nosniff");
  out.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  if (url.protocol === "https:") {
    out.headers.set("strict-transport-security", "max-age=31536000");
  }
  if (out.headers.get("content-type")?.startsWith("text/html")) {
    out.headers.set("x-frame-options", "DENY");
    if (csp) {
      out.headers.set(CSP, csp);
    }
  }
  return out;
}

/** A fresh nonce per request; a client-sent policy header never reaches the app. */
export function withSecurityHeaders<E>(next: Fetcher<E>, dev = false): Fetcher<E> {
  return async (request, env, ctx) => {
    const url = new URL(request.url);
    const csp = dev ? null : contentSecurityPolicy(randomToken(16), url);
    const headers = new Headers(request.headers);
    headers.delete(CSP);
    headers.delete(`${CSP}-report-only`);
    if (csp) {
      headers.set(CSP, csp);
    }
    const forwarded = new Request(request, { headers }) as typeof request;
    return secured(await next(forwarded, env, ctx), url, csp);
  };
}
