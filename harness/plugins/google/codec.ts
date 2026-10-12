/** Base64 helpers. Workers have `atob`/`btoa`; the global `Buffer` is untyped. */

export function encodeBase64Std(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin);
}

/** `base64.URLEncoding` (padded). Gmail `raw` uses this. */
export function encodeBase64Url(bytes: Uint8Array): string {
  return encodeBase64Std(bytes).replace(/\+/g, "-").replace(/\//g, "_");
}

/** `base64.RawURLEncoding` (no padding). PKCE verifiers use this. */
export function encodeBase64UrlRaw(bytes: Uint8Array): string {
  return encodeBase64Url(bytes).replace(/=+$/u, "");
}

export function decodeBase64Std(s: string): Uint8Array | undefined {
  try {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  } catch {
    return undefined;
  }
}

/** Decode a base64url payload (padded or not) to a UTF-8 string. Throws on bad input. */
export function decodeBase64UrlToString(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bytes = decodeBase64Std(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  if (!bytes) {
    throw new Error("bad base64url");
  }
  return new TextDecoder().decode(bytes);
}

/** Gmail body data: decode, or return the raw string when it is not base64url. */
export function decodeGmailBody(s: string): string {
  try {
    return decodeBase64UrlToString(s);
  } catch {
    return s;
  }
}
