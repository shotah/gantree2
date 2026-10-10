export type BlobRequestOpts = {
  slug: string;
  rev?: number;
  secret?: string;
  bearer?: string;
};

/** Same query shape for every per-slug JPEG the Durable Object serves (face, backdrop). */
export function blobRequestPath(pathname: string, opts: BlobRequestOpts): string {
  const u = new URL(pathname, "http://pendant.local");
  u.searchParams.set("slug", opts.slug);
  if (opts.rev && opts.rev > 0) {
    u.searchParams.set("v", String(opts.rev));
  }
  if (opts.secret) {
    u.searchParams.set("secret", opts.secret);
  }
  if (opts.bearer) {
    u.searchParams.set("bearer", opts.bearer);
  }
  return `${u.pathname}${u.search}`;
}

/** `/api/chat/avatar?slug=kit` — relative, for same-origin fetch. */
export function avatarRequestPath(opts: BlobRequestOpts): string {
  return blobRequestPath("/api/chat/avatar", opts);
}
