/** VAPID application-server key (public) + JWK private. Contact is a mailto: or https: URL. */

export const VAPID_SUBJECT_DEFAULT = "https://github.com/shotah/gantree";

export type VapidCreds = {
  publicKey: string;
  privateJwk: JsonWebKey;
  subject: string;
};

export function encodeBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export function decodeBase64Url(raw: string): Uint8Array | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const padded = trimmed.replaceAll("-", "+").replaceAll("_", "/")
    + "=".repeat((4 - (trimmed.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

export function vapidPublicKeyBytes(publicKey: string): Uint8Array | null {
  const bytes = decodeBase64Url(publicKey);
  if (!bytes || bytes.byteLength !== 65 || bytes[0] !== 0x04) {
    return null;
  }
  return bytes;
}

export function parseVapidPrivate(raw: string | undefined): JsonWebKey | null {
  const src = raw?.trim() ?? "";
  if (!src) {
    return null;
  }
  try {
    const jwk = JSON.parse(src) as JsonWebKey;
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.x || !jwk.y) {
      return null;
    }
    return jwk;
  } catch {
    return null;
  }
}

export function parseVapidSubject(raw: string | undefined): string {
  const s = raw?.trim() ?? "";
  if (s.startsWith("mailto:") || s.startsWith("https://")) {
    return s;
  }
  return VAPID_SUBJECT_DEFAULT;
}

export function readVapid(env: {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}): VapidCreds | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  if (!vapidPublicKeyBytes(publicKey)) {
    return null;
  }
  const privateJwk = parseVapidPrivate(env.VAPID_PRIVATE_KEY);
  if (!privateJwk) {
    return null;
  }
  return {
    publicKey,
    privateJwk,
    subject: parseVapidSubject(env.VAPID_SUBJECT),
  };
}

export async function generateVapidKeys(): Promise<{ publicKey: string; privateJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: encodeBase64Url(raw), privateJwk };
}
