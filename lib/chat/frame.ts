import { CONTEXT_JSON_MAX, FRAME_BYTES_MAX, IMAGE_BYTES_MAX, IMAGE_MAX, TEXT_MAX, utf8Bytes } from "./caps";
import { parseAllowUsers, type RoomUser } from "./allow";
import { parseAimsFrame, type AimLink, type AimRow } from "./aims";
import { parseTodoFrame, type TodoItem } from "./todo";
import { parseCommands, type SlashCommand } from "./cmds";

export type Role = "phone" | "crane";

export type Geo = {
  lat: number;
  lon: number;
  accuracy_m?: number;
  alt_m?: number;
  heading?: number;
  speed_mps?: number;
};

export type Surface = "browser" | "android" | "android_auto" | "ios" | "carplay";

/** How the human produced this turn. `spoken` = hold-to-talk; the reply will be read aloud. */
export type InputMode = "spoken";

export type PhoneContext = {
  at?: string;
  tz?: string;
  geo?: Geo;
  battery?: { pct: number; charging: boolean };
  net?: "wifi" | "cellular" | "unknown";
  surface?: Surface;
  input?: InputMode;
};

export type FrameImage = { url: string };

export type FrameKind = "inbound" | "reply" | "push" | "ack" | "error" | "pin" | "cmds" | "allow" | "typing" | "draft" | "react" | "aims" | "todo";

export type WireFrame = {
  text?: string;
  images?: FrameImage[];
  context?: PhoneContext;
  kind?: FrameKind;
  user_id?: string;
  email?: string;
  id?: string;
  seq?: number;
  at?: number;
  since?: string;
  commands?: SlashCommand[];
  users?: RoomUser[];
  /** Crane `aims` only: the goals board snapshot (docs/frontends.md → Aims board). */
  aims?: AimRow[];
  /** Crane `aims` only: cross-aim next-day correlations under the whole board. */
  links?: AimLink[];
  /** Crane `todo` only: the pocket list snapshot (docs/frontends.md → Tasks board). */
  todo?: TodoItem[];
  /** Hydrate-only. Unread queue flush must not set this. Clients must not send it. */
  replay?: boolean;
  /**
   * Phone `ack` only: the human is looking at the thread on that mouth. The
   * mailbox copies a `seen` ack to their other mouths so those drop their
   * cards. A plain ack is delivery, not reading — never treat it as seen.
   */
  seen?: true;
};

export type ParseOpts = { role?: Role };

const ID_MAX = 128;

export type ParseOk = { ok: true; frame: WireFrame; bytes: number };
export type ParseErr = { ok: false; error: string; id?: string };
export type ParseResult = ParseOk | ParseErr;

function refuse(error: string, id?: string): ParseErr {
  return id ? { ok: false, error, id } : { ok: false, error };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseGeo(raw: unknown): Geo | undefined {
  if (raw == null || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  if (!isFiniteNumber(o.lat) || !isFiniteNumber(o.lon)) {
    return undefined;
  }
  if (o.lat < -90 || o.lat > 90 || o.lon < -180 || o.lon > 180) {
    return undefined;
  }
  const geo: Geo = { lat: o.lat, lon: o.lon };
  if (isFiniteNumber(o.accuracy_m) && o.accuracy_m >= 0) {
    geo.accuracy_m = o.accuracy_m;
  }
  if (isFiniteNumber(o.alt_m)) {
    geo.alt_m = o.alt_m;
  }
  if (isFiniteNumber(o.heading) && o.heading >= 0 && o.heading < 360) {
    geo.heading = o.heading;
  }
  if (isFiniteNumber(o.speed_mps) && o.speed_mps >= 0) {
    geo.speed_mps = o.speed_mps;
  }
  return geo;
}

function parseContext(raw: unknown): PhoneContext | undefined {
  if (raw == null || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const ctx: PhoneContext = {};
  if (typeof o.at === "string" && o.at.length <= 64) {
    ctx.at = o.at;
  }
  if (typeof o.tz === "string" && o.tz.length <= 64) {
    ctx.tz = o.tz;
  }
  const geo = parseGeo(o.geo);
  if (geo) {
    ctx.geo = geo;
  }
  if (o.battery && typeof o.battery === "object") {
    const b = o.battery as Record<string, unknown>;
    if (isFiniteNumber(b.pct) && b.pct >= 0 && b.pct <= 100 && typeof b.charging === "boolean") {
      ctx.battery = { pct: b.pct, charging: b.charging };
    }
  }
  if (o.net === "wifi" || o.net === "cellular" || o.net === "unknown") {
    ctx.net = o.net;
  }
  if (
    o.surface === "browser"
    || o.surface === "android"
    || o.surface === "android_auto"
    || o.surface === "ios"
    || o.surface === "carplay"
  ) {
    ctx.surface = o.surface;
  }
  if (o.input === "spoken") {
    ctx.input = o.input;
  }
  return ctx;
}

function imageUrlAllowed(url: string, role?: Role): boolean {
  if (url.startsWith("data:image/")) {
    return true;
  }
  return role !== "phone" && url.startsWith("https://");
}

function parseImages(raw: unknown, role?: Role): FrameImage[] | ParseErr {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return { ok: false, error: "bad frame" };
  }
  if (raw.length > IMAGE_MAX) {
    return { ok: false, error: "too large" };
  }
  const out: FrameImage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "bad frame" };
    }
    const url = (item as Record<string, unknown>).url;
    if (typeof url !== "string" || url.length === 0) {
      return { ok: false, error: "bad frame" };
    }
    if (!imageUrlAllowed(url, role)) {
      return { ok: false, error: "bad frame" };
    }
    if (utf8Bytes(url) > IMAGE_BYTES_MAX) {
      return { ok: false, error: "too large" };
    }
    out.push({ url });
  }
  return out;
}

function parseIdField(raw: unknown): string | ParseErr | undefined {
  if (raw == null) {
    return undefined;
  }
  if (typeof raw !== "string" || raw.length > ID_MAX) {
    return { ok: false, error: "bad frame" };
  }
  return raw.length ? raw : undefined;
}

/** Mailbox sequence; 1-based. Ignore junk so an old client cannot poison a frame. */
export function orderSeq(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 1) {
    return undefined;
  }
  return raw;
}

/** Epoch ms when the mailbox accepted the frame. */
export function orderAt(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
    return undefined;
  }
  return raw;
}

/** Drop client-supplied order so only the mailbox stamps seq/at. */
export function stripClientOrder(frame: WireFrame): WireFrame {
  const next = { ...frame };
  delete next.seq;
  delete next.at;
  delete next.replay;
  return next;
}

/** Put queue seq/at on a stored body so catch-up paints in mailbox order. */
export function stampOrderOnBody(body: string, meta: { seq?: number; at?: number }): string {
  const seq = orderSeq(meta.seq);
  const at = orderAt(meta.at);
  if (seq == null && at == null) {
    return body;
  }
  const parsed = parseFrame(body);
  if (!parsed.ok) {
    return body;
  }
  const frame = { ...parsed.frame };
  let changed = false;
  if (seq != null && frame.seq !== seq) {
    frame.seq = seq;
    changed = true;
  }
  if (at != null && frame.at !== at) {
    frame.at = at;
    changed = true;
  }
  return changed ? encodeFrame(frame) : body;
}

/** Mark a stored body as transcript hydrate so mouths skip toast / haptic / Auto HUN. */
export function stampReplayOnBody(body: string): string {
  const parsed = parseFrame(body);
  if (!parsed.ok || parsed.frame.replay === true) {
    return body;
  }
  return encodeFrame({ ...parsed.frame, replay: true });
}

const KINDS = new Set<FrameKind>(["inbound", "reply", "push", "ack", "error", "pin", "cmds", "allow", "typing", "draft", "react", "aims", "todo"]);

/** Parse a mailbox frame. Never logs the body. */
export function parseFrame(raw: string | ArrayBuffer | Uint8Array, opts?: ParseOpts): ParseResult {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  const bytes = utf8Bytes(text);
  if (bytes > FRAME_BYTES_MAX) {
    return { ok: false, error: "too large" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: "bad frame" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "bad frame" };
  }
  const o = parsed as Record<string, unknown>;
  const idField = parseIdField(o.id);
  if (idField && typeof idField === "object") {
    return idField;
  }
  const frame: WireFrame = {};
  if (o.text != null) {
    if (typeof o.text !== "string") {
      return refuse("bad frame", idField);
    }
    if (utf8Bytes(o.text) > TEXT_MAX) {
      return refuse("too large", idField);
    }
    frame.text = o.text;
  }
  if (o.kind != null) {
    if (typeof o.kind !== "string" || !KINDS.has(o.kind as FrameKind)) {
      return refuse("bad frame", idField);
    }
    frame.kind = o.kind as FrameKind;
  }
  if (o.user_id != null) {
    if (typeof o.user_id !== "string" || o.user_id.length > 128) {
      return refuse("bad frame", idField);
    }
    frame.user_id = o.user_id;
  }
  if (o.email != null) {
    if (typeof o.email !== "string" || o.email.length > 254) {
      return refuse("bad frame", idField);
    }
    const email = o.email.trim().toLowerCase();
    if (email) {
      frame.email = email;
    }
  }
  if (idField) {
    frame.id = idField;
  }
  const since = parseIdField(o.since);
  if (since && typeof since === "object") {
    return refuse("bad frame", idField);
  }
  if (since) {
    frame.since = since;
  }
  const seq = orderSeq(o.seq);
  if (seq != null) {
    frame.seq = seq;
  }
  const at = orderAt(o.at);
  if (at != null) {
    frame.at = at;
  }
  const images = parseImages(o.images, opts?.role);
  if (!Array.isArray(images)) {
    return refuse(images.error, idField);
  }
  if (images.length) {
    frame.images = images;
  }
  if (o.kind === "cmds") {
    frame.commands = parseCommands(o.commands);
  }
  if (o.kind === "allow") {
    frame.users = parseAllowUsers(o.users);
  }
  if (o.kind === "aims") {
    const board = parseAimsFrame(o);
    frame.aims = board.aims;
    frame.links = board.links;
  }
  if (o.kind === "todo") {
    frame.todo = parseTodoFrame(o);
  }
  if (o.replay === true) {
    frame.replay = true;
  }
  if (o.seen === true) {
    frame.seen = true;
  }
  if (o.context != null) {
    const blob = JSON.stringify(o.context);
    if (utf8Bytes(blob) > CONTEXT_JSON_MAX) {
      return refuse("too large", idField);
    }
    const ctx = parseContext(o.context);
    if (ctx) {
      frame.context = ctx;
    }
  }
  return { ok: true, frame, bytes };
}

export function encodeFrame(frame: WireFrame): string {
  return JSON.stringify(frame);
}

/** Mailbox refusal. `id` is additive so the sender can mark that bubble. */
export function encodeError(text: string, id?: string): string {
  return encodeFrame({ kind: "error", text, id });
}

export function hasText(frame: WireFrame): boolean {
  return Boolean(frame.text?.trim());
}

export function hasImages(frame: WireFrame): boolean {
  return Boolean(frame.images?.length);
}

export function hasGeo(frame: WireFrame): boolean {
  return frame.context?.geo != null;
}

/** Bare pin: geo only, no text, no photo. Crane should update here and stay silent. */
export function isBareGeo(frame: WireFrame): boolean {
  return hasGeo(frame) && !hasText(frame) && !hasImages(frame);
}

export function peerOf(role: Role): Role {
  return role === "phone" ? "crane" : "phone";
}
