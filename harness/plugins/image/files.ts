import { Buffer } from "node:buffer";
import path from "node:path";
import type { Clock } from "@/harness/core/clock";
import type { Migration, Sql, SqlValue } from "@/harness/core/sql";
import { migrate } from "@/harness/core/sql";

/** Shared handoff for photo_generate → avatar_update / photo_edit. The Go servers used one directory. */
export const imageOutputMigration: Migration = {
  id: "image.output.001",
  up: ["CREATE TABLE IF NOT EXISTS image_output (path TEXT PRIMARY KEY, bytes BLOB NOT NULL)"],
};

let fileSeq = 0;

export function ensureImageOutput(sql: Sql): void {
  migrate(sql, [imageOutputMigration]);
}

export function putOutputFile(sql: Sql, filePath: string, bytes: Uint8Array): void {
  const full = canonicalPath(filePath);
  if (!full) throw new Error("bad path");
  ensureImageOutput(sql);
  sql.exec(
    "INSERT INTO image_output (path, bytes) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET bytes = excluded.bytes",
    full,
    bytes,
  );
}

export function readOutputFile(sql: Sql, filePath: string): Uint8Array | null {
  const full = canonicalPath(filePath);
  if (!full) return null;
  ensureImageOutput(sql);
  const row = sql.one<{ bytes: SqlValue }>("SELECT bytes FROM image_output WHERE path = ?", full);
  if (!row) return null;
  return asBytes(row.bytes);
}

export function writeOutputFile(sql: Sql, clock: Clock, dirRaw: string, data: Uint8Array, ext: string): string {
  const trimmed = dirRaw.trim();
  if (!trimmed) return "";
  const cleaned = path.posix.normalize(trimmed);
  if (cleaned === "." || cleaned.includes("..")) {
    throw new Error("IMAGE_OUTPUT_DIR must be a concrete directory");
  }
  const dir = cleaned.startsWith("/") ? cleaned : path.posix.resolve(cleaned);
  ensureImageOutput(sql);
  fileSeq += 1;
  const name = `${clock.now()}${fileSeq}${ext}`;
  const full = path.posix.join(dir, name);
  sql.exec("INSERT INTO image_output (path, bytes) VALUES (?, ?)", full, data);
  return full;
}

export type PathMessages = {
  needDir: string;
  required: string;
  refuse: string;
  unreadable: string;
  empty: string;
};

export function readInsideRoots(sql: Sql, raw: string, roots: string[], msg: PathMessages): Uint8Array {
  if (roots.length === 0) throw new Error(msg.needDir);
  const resolved = resolveInsideRoots(raw, roots, msg);
  const data = readOutputFile(sql, resolved);
  if (!data) throw new Error(msg.refuse);
  if (data.byteLength === 0) throw new Error(msg.empty);
  return data;
}

export function resolveInsideRoots(raw: string, roots: string[], msg: PathMessages): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(msg.required);
  const abs = canonicalPath(trimmed);
  if (!abs) throw new Error(msg.refuse);
  if (!roots.some((root) => pathInsideRoot(abs, root))) throw new Error(msg.refuse);
  return abs;
}

export function canonicalPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const abs = trimmed.startsWith("/") ? trimmed : path.posix.resolve(trimmed);
  const cleaned = path.posix.normalize(abs);
  if (!cleaned.startsWith("/")) return null;
  return cleaned;
}

function pathInsideRoot(resolved: string, root: string): boolean {
  const rootAbs = canonicalPath(root);
  if (!rootAbs) return false;
  if (resolved === rootAbs) return true;
  const prefix = rootAbs.endsWith("/") ? rootAbs : `${rootAbs}/`;
  return resolved.startsWith(prefix);
}

export function decodeBase64(raw: string): Uint8Array | null {
  let s = raw.trim();
  const comma = s.indexOf(",");
  if (comma >= 0 && s.slice(0, comma).toLowerCase().includes("base64")) {
    s = s.slice(comma + 1).trim();
  }
  if (!s) return new Uint8Array();
  const std = decodeStd(s);
  if (std) return std;
  if (!/^[A-Za-z0-9+/]+$/.test(s)) return null;
  const pad = s + "=".repeat((4 - (s.length % 4)) % 4);
  return decodeStd(pad);
}

const bufferApi = Buffer as unknown as {
  from(data: Uint8Array): { toString(encoding: "base64"): string };
  from(data: string, encoding: "base64"): Uint8Array;
};
const encodeB64 = (data: Uint8Array) => bufferApi.from(data);
const decodeB64 = (data: string) => bufferApi.from(data, "base64");

export function encodeBase64(data: Uint8Array): string {
  return encodeB64(data).toString("base64");
}

export function decodeBase64Bytes(data: string): Uint8Array {
  return new Uint8Array(decodeB64(data));
}

function decodeStd(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) return null;
  const buf = decodeB64(s);
  const again = encodeB64(buf).toString("base64").replace(/=+$/, "");
  if (again !== s.replace(/=+$/, "")) return null;
  return new Uint8Array(buf);
}

function asBytes(v: SqlValue): Uint8Array | null {
  if (v instanceof Uint8Array) return new Uint8Array(v);
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return null;
}

export function extForMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".png";
  }
}

export function mimeFromPath(filePath: string): string {
  switch (path.posix.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "image/png";
  }
}
