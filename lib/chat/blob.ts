/** Strong validator for a stored JPEG: the rev is the identity. */
export function blobEtag(rev: number): string {
  return `"${rev}"`;
}

/** `If-None-Match` names this rev (list, weak `W/`, or `*` all count). */
export function etagMatches(ifNoneMatch: string | null | undefined, etag: string): boolean {
  if (!ifNoneMatch) {
    return false;
  }
  return ifNoneMatch.split(",").some((raw) => {
    const tag = raw.trim();
    return tag === "*" || tag === etag || tag === `W/${etag}`;
  });
}

/**
 * GET answer for a stored JPEG. A caller that already holds this rev sends
 * `If-None-Match` and gets an empty 304; everyone else gets the JPEG.
 * `X-Chat-Rev` is the rev phones cache under. (Was `X-Pendant-Rev`.)
 */
export function blobResponse(hit: { jpeg: ArrayBuffer; rev: number }, ifNoneMatch: string | null): Response {
  const etag = blobEtag(hit.rev);
  const headers: Record<string, string> = {
    "X-Chat-Rev": String(hit.rev),
    ETag: etag,
    "Cache-Control": "private, max-age=0, must-revalidate",
  };
  if (etagMatches(ifNoneMatch, etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(hit.jpeg, { headers: { ...headers, "Content-Type": "image/jpeg" } });
}
