/**
 * Presigned snapshot URLs and the R2 keys they read and write.
 *
 * sig = HMAC-SHA256(roomBearer, `${slug}|${file}|${method}|${exp}`)
 * exp is ms epoch and must be at most 15 minutes ahead of now.
 * Keys: backups/<slug>/latest/<file> and backups/<slug>/<stamp>/<file>.
 *
 * `tokens_tar` is AES-256-GCM ciphertext (12-byte nonce, then the seal) of a
 * tar of OAuth token files. This module stores the bytes and does not decrypt.
 */
import { AGENT_SLUG } from "@/lib/agents/types";

export const SNAPSHOT_FILES = ["gantry_db", "self_md", "tokens_tar"] as const;
export type SnapshotFile = (typeof SNAPSHOT_FILES)[number];

/** Agent DO storage row, beside the room bearer (`bearer`). Standard base64 of 32 bytes. */
export const SNAPSHOT_KEY_STORE_KEY = "snapshot.key";

const SNAPSHOT_KEY_BYTES = 32;
const SNAPSHOT_KEY_B64 = /^[A-Za-z0-9+/]{43}=$/;

/** UTC compact stamp the harness puts on a snapshot frame: YYYYMMDDThhmmssZ. */
export const SNAPSHOT_STAMP = /^\d{8}T\d{6}Z$/;

export const SNAPSHOT_TTL_MS = 15 * 60 * 1000;

/** Matches the harness restore cap (256 MiB). */
export const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;

export const SNAPSHOT_CONTENT_TYPE = "application/octet-stream";

export type SnapshotUrls = { gantry_db: string; self_md: string; tokens_tar: string };

export function emptySnapshotUrls(): SnapshotUrls {
  return { gantry_db: "", self_md: "", tokens_tar: "" };
}

/** True when `value` is standard base64 of exactly 32 bytes. */
export function snapshotKeyOk(value: string): boolean {
  if (!SNAPSHOT_KEY_B64.test(value)) {
    return false;
  }
  try {
    return atob(value).length === SNAPSHOT_KEY_BYTES;
  } catch {
    return false;
  }
}

/** One-time per-agent AES-256 key, standard base64. */
export function mintSnapshotKey(): string {
  const bytes = new Uint8Array(SNAPSHOT_KEY_BYTES);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export type SnapshotStore = {
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
};

export function isSnapshotFile(value: string): value is SnapshotFile {
  for (const file of SNAPSHOT_FILES) {
    if (file === value) {
      return true;
    }
  }
  return false;
}

export function snapshotTooBig(bytes: number, max = MAX_SNAPSHOT_BYTES): boolean {
  return bytes > max;
}

export function latestKey(slug: string, file: SnapshotFile): string {
  return `backups/${slug}/latest/${file}`;
}

export function stampedKey(slug: string, stamp: string, file: SnapshotFile): string {
  return `backups/${slug}/${stamp}/${file}`;
}

export function snapshotCanonical(slug: string, file: string, method: string, exp: string): string {
  return `${slug}|${file}|${method}|${exp}`;
}

function bytesToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex: string): ArrayBuffer | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    return null;
  }
  const out = new ArrayBuffer(hex.length / 2);
  const view = new Uint8Array(out);
  for (let i = 0; i < view.length; i++) {
    const byte = hex.slice(i * 2, i * 2 + 2);
    const value = Number.parseInt(byte, 16);
    if (!Number.isFinite(value)) {
      return null;
    }
    view[i] = value;
  }
  return out;
}

async function hmacKey(bearer: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(bearer),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSnapshot(
  bearer: string,
  slug: string,
  file: SnapshotFile,
  method: "GET" | "PUT",
  exp: number,
): Promise<string> {
  const key = await hmacKey(bearer);
  const data = new TextEncoder().encode(snapshotCanonical(slug, file, method, String(exp)));
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return bytesToHex(sig);
}

/**
 * True when `sig` matches and `exp` is still in the future, at most 15 minutes
 * ahead of `now`. `expRaw` is the query string, used verbatim in the MAC.
 */
export async function verifySnapshot(
  bearer: string,
  slug: string,
  file: string,
  method: string,
  expRaw: string,
  sig: string,
  now: number,
): Promise<boolean> {
  if (!bearer || !AGENT_SLUG.test(slug) || !isSnapshotFile(file)) {
    return false;
  }
  if (method !== "GET" && method !== "PUT") {
    return false;
  }
  if (!/^[0-9]{1,15}$/.test(expRaw)) {
    return false;
  }
  const exp = Number(expRaw);
  if (!Number.isSafeInteger(exp) || exp <= now || exp > now + SNAPSHOT_TTL_MS) {
    return false;
  }
  const sigBytes = hexToBytes(sig);
  if (!sigBytes) {
    return false;
  }
  const key = await hmacKey(bearer);
  const encoded = new TextEncoder().encode(snapshotCanonical(slug, file, method, expRaw));
  const data = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
  return crypto.subtle.verify("HMAC", key, sigBytes, data);
}

function snapshotUrl(origin: string, slug: string, file: SnapshotFile, exp: number, sig: string): string {
  const url = new URL(`/api/agents/${slug}/snapshot/${file}`, origin);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("sig", sig);
  return url.toString();
}

/** GET urls in `restore`, PUT urls in `put`. Null when there is nothing to sign. */
export async function signedSnapshotUrls(input: {
  origin: string;
  slug: string;
  bearer: string;
  exp: number;
}): Promise<{ restore: SnapshotUrls; put: SnapshotUrls } | null> {
  if (!input.bearer || !AGENT_SLUG.test(input.slug) || !Number.isSafeInteger(input.exp)) {
    return null;
  }
  const restore = emptySnapshotUrls();
  const put = emptySnapshotUrls();
  for (const file of SNAPSHOT_FILES) {
    const getSig = await signSnapshot(input.bearer, input.slug, file, "GET", input.exp);
    const putSig = await signSnapshot(input.bearer, input.slug, file, "PUT", input.exp);
    restore[file] = snapshotUrl(input.origin, input.slug, file, input.exp, getSig);
    put[file] = snapshotUrl(input.origin, input.slug, file, input.exp, putSig);
  }
  return { restore, put };
}

const putOptions = { httpMetadata: { contentType: SNAPSHOT_CONTENT_TYPE } };

export async function writeSnapshot(
  store: SnapshotStore,
  slug: string,
  file: SnapshotFile,
  body: ArrayBuffer,
  stamp?: string,
): Promise<void> {
  await store.put(latestKey(slug, file), body, putOptions);
  if (stamp && SNAPSHOT_STAMP.test(stamp)) {
    await store.put(stampedKey(slug, stamp, file), body, putOptions);
  }
}

export async function readSnapshot(
  store: SnapshotStore,
  slug: string,
  file: SnapshotFile,
  stamp?: string,
): Promise<ArrayBuffer | null> {
  const key = stamp && SNAPSHOT_STAMP.test(stamp) ? stampedKey(slug, stamp, file) : latestKey(slug, file);
  const obj = await store.get(key);
  if (!obj) {
    return null;
  }
  return obj.arrayBuffer();
}

/** Copy both latest objects under `backups/<slug>/<stamp>/` after a snapshot frame. */
export async function archiveLatest(store: SnapshotStore, slug: string, stamp: string): Promise<void> {
  if (!AGENT_SLUG.test(slug) || !SNAPSHOT_STAMP.test(stamp)) {
    return;
  }
  for (const file of SNAPSHOT_FILES) {
    const obj = await store.get(latestKey(slug, file));
    if (!obj) {
      continue;
    }
    await store.put(stampedKey(slug, stamp, file), await obj.arrayBuffer(), putOptions);
  }
}
