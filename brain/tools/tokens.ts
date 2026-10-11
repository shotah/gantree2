/**
 * OAuth tokens at rest. The blob is AES-256-GCM: 12-byte nonce, then the
 * WebCrypto seal (ciphertext and tag). The key is `mintTokenKey` (standard
 * base64 of 32 bytes) or those raw bytes. Plugins see plaintext through
 * `TokenStore`.
 */
import { type Clock } from "@/brain/core/clock";
import { type Sql, type SqlValue } from "@/brain/core/sql";
import { type OAuthToken, type TokenStore } from "@/brain/core/tools";
import { migrateTools } from "./migrate";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const KEY_B64 = /^[A-Za-z0-9+/]{43}=$/;

/** Agent DO storage row, beside the room bearer. Not a config env key. */
export const TOKEN_KEY_STORE_KEY = "token.key";

export type SnapshotKey = string | Uint8Array | ArrayBuffer;

/** True when `value` is standard base64 of exactly 32 bytes. */
export function tokenKeyOk(value: string): boolean {
  if (!KEY_B64.test(value)) {
    return false;
  }
  try {
    return atob(value).length === KEY_BYTES;
  } catch {
    return false;
  }
}

/** One-time per-agent AES-256 key, standard base64. */
export function mintTokenKey(): string {
  const bytes = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Standard base64 of 32 bytes, or the raw 32 bytes. */
export function decodeSnapshotKey(key: SnapshotKey): Uint8Array {
  if (key instanceof ArrayBuffer) {
    return decodeSnapshotKey(new Uint8Array(key));
  }
  if (key instanceof Uint8Array) {
    if (key.byteLength !== KEY_BYTES) {
      throw new Error("snapshot key must be 32 bytes");
    }
    return new Uint8Array(key);
  }
  if (!KEY_B64.test(key)) {
    throw new Error("snapshot key must be standard base64 of 32 bytes");
  }
  let binary: string;
  try {
    binary = atob(key);
  } catch {
    throw new Error("snapshot key must be standard base64 of 32 bytes");
  }
  if (binary.length !== KEY_BYTES) {
    throw new Error("snapshot key must be 32 bytes");
  }
  const out = new Uint8Array(KEY_BYTES);
  for (let i = 0; i < KEY_BYTES; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

type TokenRow = { blob: SqlValue; at: SqlValue };

export class AesTokenStore implements TokenStore {
  constructor(sql: Sql, key: SnapshotKey, clock: Clock) {
    this.sql = sql;
    this.rawKey = toArrayBuffer(decodeSnapshotKey(key));
    this.clock = clock;
    migrateTools(sql);
  }

  async get(provider: string): Promise<OAuthToken | null> {
    const id = provider.trim();
    if (!id) {
      return null;
    }
    const row = this.sql.one<TokenRow>("SELECT blob, at FROM oauth_token WHERE provider = ?", id);
    if (!row) {
      return null;
    }
    const plain = await this.decrypt(asBytes(row.blob));
    return parseToken(plain);
  }

  async put(provider: string, token: OAuthToken): Promise<void> {
    const id = provider.trim();
    if (!id) {
      throw new Error("oauth token: provider is required");
    }
    if (!token.accessToken) {
      throw new Error("oauth token: accessToken is required");
    }
    const blob = await this.encrypt(token);
    this.sql.exec(
      `INSERT INTO oauth_token (provider, blob, at) VALUES (?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET blob = excluded.blob, at = excluded.at`,
      id,
      blob,
      this.clock.now(),
    );
  }

  delete(provider: string): Promise<void> {
    const id = provider.trim();
    if (!id) {
      return Promise.resolve();
    }
    this.sql.exec("DELETE FROM oauth_token WHERE provider = ?", id);
    return Promise.resolve();
  }

  private readonly sql: Sql;
  private readonly rawKey: ArrayBuffer;
  private readonly clock: Clock;
  private cryptoKey: Promise<CryptoKey> | null = null;

  private key(): Promise<CryptoKey> {
    this.cryptoKey ??= crypto.subtle.importKey("raw", this.rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    return this.cryptoKey;
  }

  private async encrypt(token: OAuthToken): Promise<Uint8Array> {
    const iv = new ArrayBuffer(NONCE_BYTES);
    crypto.getRandomValues(new Uint8Array(iv));
    const plain = toArrayBuffer(new TextEncoder().encode(JSON.stringify(token)));
    const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await this.key(), plain);
    const blob = new Uint8Array(NONCE_BYTES + sealed.byteLength);
    blob.set(new Uint8Array(iv), 0);
    blob.set(new Uint8Array(sealed), NONCE_BYTES);
    return blob;
  }

  private async decrypt(blob: Uint8Array): Promise<string> {
    if (blob.byteLength < NONCE_BYTES + 16) {
      throw new Error("oauth token: decrypt failed");
    }
    const iv = toArrayBuffer(blob.subarray(0, NONCE_BYTES));
    const sealed = toArrayBuffer(blob.subarray(NONCE_BYTES));
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await this.key(), sealed);
      return new TextDecoder().decode(plain);
    } catch (err) {
      throw new Error("oauth token: decrypt failed", { cause: err });
    }
  }
}

/** A standalone ArrayBuffer, which WebCrypto accepts as a BufferSource. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function asBytes(value: SqlValue): Uint8Array {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  throw new Error("oauth token: decrypt failed");
}

function parseToken(raw: string): OAuthToken {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error("oauth token: decrypt failed", { cause: err });
  }
  if (!isRecord(parsed) || typeof parsed.accessToken !== "string" || parsed.accessToken === "") {
    throw new Error("oauth token: decrypt failed");
  }
  const token: OAuthToken = { accessToken: parsed.accessToken };
  if (typeof parsed.refreshToken === "string") {
    token.refreshToken = parsed.refreshToken;
  }
  if (typeof parsed.expiresAt === "number") {
    token.expiresAt = parsed.expiresAt;
  }
  if (typeof parsed.scope === "string") {
    token.scope = parsed.scope;
  }
  if (typeof parsed.tokenType === "string") {
    token.tokenType = parsed.tokenType;
  }
  if (isStringRecord(parsed.extra)) {
    token.extra = parsed.extra;
  }
  return token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every((item) => typeof item === "string");
}
