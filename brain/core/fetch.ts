/**
 * Workers throws "Illegal invocation" when `fetch` runs with the wrong
 * `this`. Plugin code calls `ctx.fetch(url)`, which sets `this` to the
 * plugin context. Binding to the global keeps the receiver legal.
 * https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors
 */
export function bindWorkerFetch(fetchImpl: typeof fetch = globalThis.fetch): typeof fetch {
  return fetchImpl.bind(globalThis);
}
