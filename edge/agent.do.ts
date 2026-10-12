import { DurableObject } from "cloudflare:workers";
import type { Brain } from "@/harness/core/brain";
import type { Emit, Inbound } from "@/harness/core/wire";
import { bindWorkerFetch } from "@/harness/core/fetch";
import { dropRoomBrain, openRoomBrain } from "@/harness/room";
import { filePersona, openPersonaStore } from "@/harness/room/persona";
import { openSelfStore } from "@/harness/room/self";
import { MAX_CHARS, type PersonaStore } from "@/harness/persona";
import { maxChars } from "@/harness/selfnote/stamp";
import type { AgentEnv } from "@/lib/chat/env";
import { directoryApply, directoryRemember } from "@/lib/chat/directory";
import { blobResponse } from "@/lib/chat/blob";
import { encodeFaceNotice, packAvatar, AVATAR_STORE_KEY, displaySlug, type StoredAvatar } from "@/lib/chat/face";
import { BACKDROP_STORE_KEY, encodeBackdropNotice, packBackdrop, type StoredBackdrop } from "@/lib/chat/backdrop";
import { encodeThemeNotice, encodeThemeState, parseThemeWrite, THEME_STORE_KEY } from "@/lib/theme/store";
import { knownTheme } from "@/lib/theme/catalog";
import {
  ALLOW_HASH_KEY,
  ALLOW_STORE_KEY,
  SLUG_STORE_KEY,
  allowHash,
  agentPublishedAllow,
  parseAllowUsers,
  parseStoredSlug,
  phoneMustNotPublishAllow,
  type RoomUser,
} from "@/lib/chat/allow";
import { utf8Bytes } from "@/lib/chat/caps";
import { AIMS_STORE_KEY, aimsStoreKey, agentPublishedAims, parseAimsBoard, parseLinks, phoneMustNotPublishAims } from "@/lib/chat/aims";
import { agentPublishedTodo, parseTodoBoard, phoneMustNotPublishTodo, TODO_STORE_KEY, todoStoreKey } from "@/lib/chat/todo";
import { agentPublishedCmds, CMDS_STORE_KEY, parseCommands, phoneMustNotPublishCmds } from "@/lib/chat/cmds";
import { encodeError, encodeFrame, parseFrame, stampOrderOnBody, stampReplayOnBody, stripClientOrder, type Role, type WireFrame } from "@/lib/chat/frame";
import {
  cursorStoreKey,
  drainFor,
  enqueue,
  mergeCursor,
  newQueueId,
  peekFor,
  phoneMayDeleteQueued,
  pruneQueue,
  queuedFromList,
  queueIdentity,
  QUEUE_SEQ_KEY,
  queueStoreKey,
  QUEUE_STORE_PREFIX,
  seqForSince,
  shouldQueue,
  type Queued,
} from "@/lib/chat/queue";
import {
  appendTranscript,
  asTranscript,
  hydrateTranscript,
  shouldTranscript,
  transcriptStoreKey,
} from "@/lib/chat/transcript";
import {
  emptyReply,
  exceptSender,
  persistInboundForPhone,
  persistRole,
  resolvePhoneKind,
  routeTag,
  siblingPhoneTag,
} from "@/lib/chat/route";
import { parseEmailVerified, parseExpMs, socketMessageAllowed } from "@/lib/chat/socketAuth";
import { pruneDualLimits, takeFrame, type DualLimit } from "@/lib/chat/rate";
import { HeldDrafts, blankDraft, clearsDraft, agentPublishedDraft, phoneMustNotPublishDraft } from "@/lib/chat/draft";
import {
  applyReaction,
  asReactions,
  agentPublishedReact,
  encodeReaction,
  reactionFor,
  reactionFramesFor,
  reactionsStoreKey,
  type Reaction,
} from "@/lib/chat/react";
import { bareAck, seenAckFor } from "@/lib/chat/seen";
import { agentPublishedTyping, phoneMustNotPublishTyping } from "@/lib/chat/typing";
import {
  collectTagged,
  fanOut,
  isSocketOpen,
  parseSocketTags,
  queueForAgent,
  roleTag,
  socketTags,
  subTag,
  type SocketMeta,
} from "@/lib/chat/tags";
import { fanWebPush, testWebPush } from "@/lib/chat/push/fan";
import { sendWebPush, sendWebPushDetailed } from "@/lib/chat/push/send";
import {
  dropPush,
  parsePushDelete,
  parsePushPut,
  parsePushTest,
  prunePushForRoom,
  PUSH_STORE_PREFIX,
  pushStoreKey,
  upsertPush,
  type StoredPush,
} from "@/lib/chat/push/subscription";
import { readVapid } from "@/lib/chat/push/vapid";
import { BEARER_STORE_KEY } from "@/lib/chat/bearer";
import {
  applyConfigPatch,
  canonicalEnv,
  CONFIG_STARTED_KEY,
  CONFIG_STORE_KEY,
  configFrame,
  configView,
  parseConfig,
  startedEnvFor,
} from "@/lib/agents/config";
import type { AgentConfig } from "@/lib/agents/types";
import { houseEnv, houseKeys } from "@/lib/agents/house";
import { oauthCatchRedirect, oauthRedirectPlugin } from "@/lib/agents/oauth";
import {
  applyHarnessFrame,
  harnessKind,
  LOG_STORE_KEY,
  noteBrainOpen,
  pageLog,
  parseLog,
  parseStatus,
  STATUS_STORE_KEY,
} from "@/lib/agents/status";
import type { SampleInput } from "@/lib/door/settingsStore";
import { sealOAuthCatch, sessionKey } from "@/lib/door/session";

const RATE_KEY = "rate";

/** Alarms at or before now are dropped; schedule at least this far ahead. */
const ALARM_MIN_LEAD_MS = 1000;

/** One JPEG per slug, served over HTTP and announced on every socket when it changes. */
type StoredJpeg = StoredAvatar | StoredBackdrop;
type BlobSpec = {
  key: string;
  pack: (bytes: Uint8Array, now: number) => { ok: true; stored: StoredJpeg } | { ok: false; detail: string };
  notice: (rev: number) => string;
  saved: string;
  /** DELETE is allowed only when there is a "cleared" answer (the face has no empty state). */
  cleared?: string;
};

const PUBLIC_ORIGIN_KEY = "public.origin";

const FACE_BLOB: BlobSpec = {
  key: AVATAR_STORE_KEY,
  pack: packAvatar,
  notice: encodeFaceNotice,
  saved: "saved avatar.jpg",
};

const BACKDROP_BLOB: BlobSpec = {
  key: BACKDROP_STORE_KEY,
  pack: packBackdrop,
  notice: encodeBackdropNotice,
  saved: "saved backdrop.jpg",
  cleared: "cleared backdrop",
};

export class Agent extends DurableObject<AgentEnv> {
  /**
   * Latest `draft` text per `sub` while Kit is mid-answer, so a phone that
   * redials (Cab sweep, PWA tab hide) gets the bubble back on connect. Memory
   * only: a room mid-stream does not hibernate, and if it ever does the
   * phone just waits for `reply` as before. Dropped on `reply` / `error` /
   * blank `draft`, when the last crane socket goes, or after
   * `HELD_DRAFT_TTL_MS` with no words and no `typing`.
   */
  private readonly drafts = new HeldDrafts();
  /** Native harness for this isolate. Dropped when env or persona changes. */
  private harness: Brain | null = null;
  /** Serialises harness `emit` frames onto the crane path. */
  private craneChain: Promise<void> = Promise.resolve();
  /** Last public origin this DO saw (phone upgrade or auth start). `PUBLIC_ORIGIN` still wins. */
  private publicOrigin: string | null = null;

  constructor(ctx: DurableObjectState, env: AgentEnv) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request: Request): Promise<Response> {
    await this.noteRequestOrigin(request);
    if (request.headers.get("X-Chat-Op") === "avatar") {
      return this.blobHttp(request, FACE_BLOB);
    }
    if (request.headers.get("X-Chat-Op") === "backdrop") {
      return this.blobHttp(request, BACKDROP_BLOB);
    }
    if (request.headers.get("X-Chat-Op") === "theme") {
      return this.themeHttp(request);
    }
    if (request.headers.get("X-Chat-Op") === "allow") {
      return this.allowHttp(request);
    }
    if (request.headers.get("X-Chat-Op") === "bearer") {
      return this.bearerHttp(request);
    }
    if (request.headers.get("X-Chat-Op") === "push") {
      return this.pushHttp(request);
    }
    if (request.headers.get("X-Chat-Op") === "config") {
      return this.configHttp(request);
    }
    if (request.headers.get("X-Chat-Op") === "status") {
      return this.statusHttp(request);
    }
    if (request.headers.get("X-Chat-Op") === "restart") {
      return this.restartHttp(request);
    }
    if (request.headers.get("X-Chat-Op") === "pause") {
      return this.pauseHttp(request);
    }
    if (request.headers.get("X-Chat-Op") === "destroy") {
      return this.destroyHttp(request);
    }
    if (request.headers.get("X-Chat-Op") === "log") {
      return this.logHttp(request);
    }
    if (request.headers.get("X-Chat-Op") === "auth") {
      return this.authHttp(request);
    }
    if (request.headers.get("X-Chat-Op") === "auth_start") {
      return this.authStartHttp(request);
    }
    if (request.headers.get("X-Chat-Op") === "self_get" || request.headers.get("X-Chat-Op") === "self_put") {
      return this.selfHttp(request);
    }
    const personaOp = request.headers.get("X-Chat-Op");
    if (personaOp === "persona_get" || personaOp === "persona_put" || personaOp === "persona_delete") {
      return this.personaHttp(request);
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const role = request.headers.get("X-Chat-Role");
    const rateId = request.headers.get("X-Chat-Rate") ?? "anon";
    const userId = request.headers.get("X-Chat-Sub") ?? undefined;
    const email = request.headers.get("X-Chat-Email") ?? undefined;
    const verified = request.headers.get("X-Chat-EmailVerified") ?? "";
    const exp = request.headers.get("X-Chat-Exp") ?? "";
    const doorRoleRaw = request.headers.get("X-Chat-Door-Role") ?? "";
    const doorRole = doorRoleRaw === "admin" || doorRoleRaw === "operator" || doorRoleRaw === "member"
      ? doorRoleRaw
      : undefined;
    const assignedAgents = (request.headers.get("X-Chat-Assigned") ?? "").split(",").filter(Boolean);
    const slug = parseStoredSlug(request.headers.get("X-Chat-Slug") ?? "");
    if (role !== "phone" && role !== "crane") {
      return new Response("bad role", { status: 400 });
    }
    if (slug) {
      await this.ctx.storage.put(SLUG_STORE_KEY, slug);
      if (role === "crane") {
        await this.indexRoom(slug);
      }
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], socketTags({
      role,
      rateId,
      userId,
      expMs: parseExpMs(exp),
      email,
      emailVerified: parseEmailVerified(verified),
      doorRole,
      assignedAgents,
      chatSlug: slug ?? undefined,
    }));
    if (role === "crane") {
      await this.sendConfig(pair[1]);
    }
    await this.flush(pair[1], role, userId);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const meta = this.meta(ws);
    if (meta.role === "crane") {
      const body = typeof message === "string" ? message : new TextDecoder().decode(message);
      await this.handleCraneFrame(body, meta, ws);
      return;
    }
    await this.dispatchSocket(message, meta, ws);
  }

  async alarm(): Promise<void> {
    const harness = await this.nativeBrain();
    let next: number | null = null;
    await this.withEmit(async (emit) => {
      next = await harness.alarm(emit);
    });
    await this.armAlarm(next);
  }

  /**
   * One crane socket message, or one frame the native harness emitted.
   * `status` / `perf` / `log` fold; chat frames take the crane branch of the room.
   */
  private async handleCraneFrame(body: string, meta: SocketMeta, ws?: WebSocket): Promise<void> {
    await this.dispatchSocket(body, meta, ws ?? null);
  }

  private async dispatchSocket(message: string | ArrayBuffer, meta: SocketMeta, ws: WebSocket | null) {
    if (meta.role === "crane" && harnessKind(message)) {
      await this.foldHarness(message);
      return;
    }
    const now = Date.now();
    const roomUsers = this.enforce() ? await this.roomUsers() : undefined;
    if (!socketMessageAllowed({
      role: meta.role,
      userId: meta.userId,
      email: meta.email,
      emailVerified: meta.emailVerified,
      expMs: meta.expMs,
      allowedSubs: this.env.ALLOWED_SUBS,
      roomUsers,
      doorRole: meta.doorRole,
      assignedAgents: meta.assignedAgents,
      slug: meta.chatSlug,
      inDirectory: meta.inDirectory,
      enforce: this.enforce(),
      now,
    })) {
      ws?.close(4401, "unauthorized");
      return;
    }
    const parsed = parseFrame(message, { role: meta.role });
    if (!parsed.ok) {
      ws?.send(encodeError(parsed.error, parsed.id));
      return;
    }
    const out: WireFrame = stripClientOrder(parsed.frame);
    if (meta.role === "phone") {
      const kind = resolvePhoneKind(out);
      if (!kind) {
        ws?.send(encodeError("bad frame", out.id));
        return;
      }
      out.kind = kind;
      if (meta.userId) {
        out.user_id = meta.userId;
      }
      if (meta.email && meta.emailVerified) {
        out.email = meta.email;
      } else {
        delete out.email;
      }
    } else if (!out.kind) {
      out.kind = "reply";
    }
    if (meta.role === "crane" && emptyReply(out)) {
      ws?.send(encodeError("bad frame", out.id));
      return;
    }
    // Ephemeral, unstored, a few dozen bytes; the crane's 30/min bucket is for turns.
    const skipRate = agentPublishedDraft(meta.role, out.kind)
      || agentPublishedTyping(meta.role, out.kind)
      || agentPublishedReact(meta.role, out.kind);
    if (!skipRate) {
      const limits = await this.take(meta.rateId, parsed.bytes);
      if (!limits) {
        ws?.send(encodeError("rate", out.id));
        return;
      }
    }
    if (
      phoneMustNotPublishCmds(meta.role, out.kind)
      || phoneMustNotPublishAims(meta.role, out.kind)
      || phoneMustNotPublishTodo(meta.role, out.kind)
      || phoneMustNotPublishAllow(meta.role, out.kind)
      || phoneMustNotPublishTyping(meta.role, out.kind)
      || phoneMustNotPublishDraft(meta.role, out.kind)
    ) {
      ws?.send(encodeError("bad frame", out.id));
      return;
    }
    if (agentPublishedAllow(meta.role, out.kind)) {
      await this.storeAllow(parseAllowUsers(out.users), now);
      return;
    }
    if (agentPublishedCmds(meta.role, out.kind)) {
      const body = encodeFrame({ kind: "cmds", commands: parseCommands(out.commands) });
      await this.ctx.storage.put(CMDS_STORE_KEY, body);
      fanOut(this.peers(roleTag("phone")), body);
      return;
    }
    if (agentPublishedAims(meta.role, out.kind)) {
      // The goals board, latest wins, replayed on connect like cmds. An
      // empty board is stored and sent so a screen can clear. With a
      // `user_id` it is that human's; without, the room's.
      const frame: WireFrame = { kind: "aims", aims: parseAimsBoard(out.aims) };
      const links = parseLinks(out.links);
      if (links.length) {
        frame.links = links;
      }
      if (out.user_id) {
        frame.user_id = out.user_id;
      }
      const body = encodeFrame(frame);
      await this.ctx.storage.put(aimsStoreKey(out.user_id), body);
      fanOut(this.peers(out.user_id ? subTag(out.user_id) : roleTag("phone")), body);
      return;
    }
    if (agentPublishedTodo(meta.role, out.kind)) {
      // The tasks board: same shape as aims — latest wins, replayed on
      // connect, an empty list stored and sent so the drawer clears.
      const frame: WireFrame = { kind: "todo", todo: parseTodoBoard(out.todo) };
      if (out.user_id) {
        frame.user_id = out.user_id;
      }
      const body = encodeFrame(frame);
      await this.ctx.storage.put(todoStoreKey(out.user_id), body);
      fanOut(this.peers(out.user_id ? subTag(out.user_id) : roleTag("phone")), body);
      return;
    }
    if (agentPublishedTyping(meta.role, out.kind)) {
      const tag = routeTag(meta.role, out);
      if (tag && out.user_id) {
        this.drafts.touch(out.user_id, Date.now());
        fanOut(this.peers(tag), encodeFrame({ kind: "typing", user_id: out.user_id }));
      }
      return;
    }
    if (agentPublishedDraft(meta.role, out.kind)) {
      const tag = routeTag(meta.role, out);
      if (!tag || !out.user_id) {
        return;
      }
      const text = out.text ?? "";
      if (blankDraft(out)) {
        // Only a clear if there is a bubble to clear; otherwise noise.
        if (!this.drafts.drop(out.user_id)) {
          return;
        }
      } else {
        this.drafts.hold(out.user_id, text, Date.now());
      }
      fanOut(this.peers(tag), encodeFrame({ kind: "draft", user_id: out.user_id, text }));
      return;
    }
    if (meta.role === "phone" && out.kind === "ack") {
      // "Seen" rides on the phone's own ack; copy it to the human's other
      // mouths so they drop their cards (docs/frontends.md → Seen).
      const seen = seenAckFor(meta.role, out, meta.userId);
      if (seen && meta.userId && ws) {
        fanOut(exceptSender(this.peers(subTag(meta.userId)), ws), encodeFrame(seen));
      }
      if (bareAck(out)) {
        return;
      }
      if (out.since) {
        await this.dropAckedThrough(out.since, meta.userId);
      }
      if (out.id) {
        await this.ackPhoneId(out.id, meta.userId);
      }
      fanOut(this.peers(roleTag("crane")), encodeFrame(out));
      return;
    }
    if (out.kind === "react") {
      // Both ways (docs/frontends.md → Reactions). Not a turn: no seq, no
      // queue, no Web Push. Stored per human by message id so hydrate paints it.
      const reaction = reactionFor(meta.role, out);
      if (!reaction) {
        ws?.send(encodeError("bad frame", out.id));
        return;
      }
      const body = encodeFrame(encodeReaction(reaction));
      if (reaction.userId) {
        await this.storeReaction(reaction);
        const mouths = this.peers(subTag(reaction.userId));
        fanOut(ws ? exceptSender(mouths, ws) : mouths, body);
      }
      if (meta.role === "phone") {
        // Keyed by the bubble, so a second reaction on the same bubble
        // replaces the first — latest wins. The harness sees it.
        await this.handToBrain(out);
      }
      return;
    }
    if (!out.id) {
      out.id = newQueueId();
    }
    if (meta.role === "crane" && out.kind === "ack") {
      if (out.id) {
        await this.deleteQueued({ id: out.id, to: "crane" });
      }
      return;
    }
    if (shouldQueue(out.kind)) {
      out.seq = await this.nextSeq();
      out.at = now;
    }
    const body = encodeFrame(out);
    const tag = routeTag(meta.role, out);
    const peers = tag ? this.peers(tag) : [];
    const dest = persistRole(meta.role, out.kind, out.user_id);
    const phoneRow = (): Queued => ({
      id: out.id || newQueueId(),
      to: "phone",
      body,
      at: now,
      seq: out.seq,
      userId: out.user_id ?? "",
      kind: out.kind,
      bytes: utf8Bytes(body),
    });
    if (dest === "phone") {
      if (out.user_id && clearsDraft(out.kind)) {
        this.drafts.drop(out.user_id);
      }
      // Fan live sockets before durable persist. Drafts already skip
      // storage; waiting on queue+transcript here is the draft→reply hitch.
      fanOut(peers, body);
      await this.rememberPhone(phoneRow());
      await this.notifyOffline(out);
      return;
    }
    if (dest === "crane") {
      const nativeTurn = meta.role === "phone" && out.kind === "inbound";
      if (!nativeTurn) {
        const sent = fanOut(peers, body);
        if (queueForAgent(sent.length)) {
          await this.putQueued({
            id: out.id,
            to: "crane",
            body,
            at: now,
            seq: out.seq,
            userId: out.user_id,
            kind: out.kind,
            bytes: utf8Bytes(body),
          });
        }
      }
      if (persistInboundForPhone(meta.role, out.kind)) {
        await this.rememberPhone(phoneRow());
      }
      const sibling = siblingPhoneTag(meta.role, out.kind, meta.userId);
      if (sibling) {
        const mouths = this.peers(sibling);
        fanOut(ws ? exceptSender(mouths, ws) : mouths, body);
      }
      if (meta.role === "phone" && out.kind === "inbound") {
        ws?.send(encodeFrame({ kind: "ack", id: out.id }));
      }
      if (nativeTurn) {
        await this.handToBrain(out);
      }
      return;
    }
    fanOut(peers, body);
  }

  webSocketClose(ws: WebSocket): Promise<void> {
    // Hibernation keeps tags; nothing to log (bodies stay off the wire logs).
    this.forgetDraftsIfCraneGone(ws);
    return Promise.resolve();
  }

  webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, "error");
    } catch {
      // already closing
    }
    this.forgetDraftsIfCraneGone(ws);
    return Promise.resolve();
  }

  /**
   * The crane's socket dropped mid-answer: drafts and `typing` stop (the
   * crane does not redial for those; `reply` dials fresh). Without this the
   * held text is a ghost every connect flush hands back. A fresh-dial socket
   * closing while the main one is up is not "gone".
   */
  private forgetDraftsIfCraneGone(ws: WebSocket): void {
    if (parseSocketTags(this.ctx.getTags(ws)).role !== "crane") {
      return;
    }
    const others = exceptSender(this.peers(roleTag("crane")), ws).filter(isSocketOpen);
    if (!others.length) {
      this.drafts.clear();
    }
  }

  private async blobHttp(request: Request, blob: BlobSpec): Promise<Response> {
    if (request.method === "GET") {
      const hit = await this.ctx.storage.get<StoredJpeg>(blob.key);
      if (!hit) {
        return new Response(null, { status: 404 });
      }
      return blobResponse(hit, request.headers.get("If-None-Match"));
    }
    if (request.method === "PUT" || request.method === "POST") {
      const bytes = new Uint8Array(await request.arrayBuffer());
      const packed = blob.pack(bytes, Date.now());
      if (!packed.ok) {
        return Response.json({ error: packed.detail }, { status: 400 });
      }
      await this.ctx.storage.put(blob.key, packed.stored);
      this.announce(blob.notice(packed.stored.rev));
      return Response.json({ ok: true, rev: packed.stored.rev, detail: blob.saved });
    }
    if (request.method === "DELETE" && blob.cleared) {
      await this.ctx.storage.delete(blob.key);
      this.announce(blob.notice(0));
      return Response.json({ ok: true, rev: 0, detail: blob.cleared });
    }
    return new Response("method", { status: 405 });
  }

  private async serveOwnChat(request: Request): Promise<Response> {
    const segment = new URL(request.url).pathname.split("/").filter((part) => part.length > 0).pop() ?? "";
    if (segment === "avatar") {
      return this.blobHttp(request, FACE_BLOB);
    }
    if (segment === "backdrop") {
      return this.blobHttp(request, BACKDROP_BLOB);
    }
    if (segment === "theme") {
      return this.themeHttp(request);
    }
    return new Response(null, { status: 404 });
  }

  /** Every socket in the room, crane included — it ignores frames with no `user_id`. */
  private announce(body: string): void {
    fanOut(this.ctx.getWebSockets(), body);
  }

  private async themeHttp(request: Request): Promise<Response> {
    if (request.method === "GET") {
      const stored = await this.ctx.storage.get<string>(THEME_STORE_KEY);
      return new Response(encodeThemeState(knownTheme(stored)), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (request.method === "PUT" || request.method === "POST") {
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return Response.json({ error: "bad theme" }, { status: 400 });
      }
      const got = parseThemeWrite(raw);
      if (!got.ok) {
        return Response.json({ error: got.detail }, { status: 400 });
      }
      await this.ctx.storage.put(THEME_STORE_KEY, got.theme);
      this.announce(encodeThemeNotice(got.theme));
      return Response.json({ ok: true, theme: got.theme, detail: `theme ${got.theme}` });
    }
    if (request.method === "DELETE") {
      await this.ctx.storage.delete(THEME_STORE_KEY);
      this.announce(encodeThemeNotice(null));
      return Response.json({ ok: true, theme: null, detail: "cleared theme" });
    }
    return new Response("method", { status: 405 });
  }

  private async allowHttp(request: Request): Promise<Response> {
    if (request.method === "PUT") {
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return Response.json({ error: "bad users" }, { status: 400 });
      }
      if (!raw || typeof raw !== "object" || !Array.isArray((raw as { users?: unknown }).users)) {
        return Response.json({ error: "bad users" }, { status: 400 });
      }
      await this.storeAllow(parseAllowUsers((raw as { users: unknown }).users), Date.now());
      return Response.json({ users: await this.roomUsers() });
    }
    return Response.json({ users: await this.roomUsers() });
  }

  /** Internal. The worker reads this to admit the harness; it is not a client route. */
  private async bearerHttp(request: Request): Promise<Response> {
    if (request.method === "GET") {
      const bearer = await this.ctx.storage.get<string>(BEARER_STORE_KEY);
      return Response.json({ bearer: typeof bearer === "string" && bearer ? bearer : null });
    }
    if (request.method === "PUT" || request.method === "POST") {
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return Response.json({ error: "bad bearer" }, { status: 400 });
      }
      const bearer = raw && typeof raw === "object" && typeof (raw as { bearer?: unknown }).bearer === "string"
        ? (raw as { bearer: string }).bearer.trim()
        : "";
      if (!bearer) {
        return Response.json({ error: "bad bearer" }, { status: 400 });
      }
      await this.ctx.storage.put(BEARER_STORE_KEY, bearer);
      return Response.json({ ok: true });
    }
    return new Response("method", { status: 405 });
  }

  private enforce(): boolean {
    return Boolean(this.env.GOOGLE_CLIENT_ID?.trim());
  }

  private async roomUsers(): Promise<RoomUser[]> {
    const stored = await this.ctx.storage.get<RoomUser[]>(ALLOW_STORE_KEY);
    return Array.isArray(stored) ? stored : [];
  }

  private async storeAllow(users: RoomUser[], now: number): Promise<void> {
    const prev = await this.roomUsers();
    await this.ctx.storage.put(ALLOW_STORE_KEY, users);
    await this.ctx.storage.put(ALLOW_HASH_KEY, allowHash(users));
    const slug = parseStoredSlug(await this.ctx.storage.get<string>(SLUG_STORE_KEY));
    if (slug && this.env.DIRECTORY) {
      try {
        await directoryApply(this.env.DIRECTORY, slug, prev, users);
      } catch {
        // KV is an index, not the door
      }
    }
    for (const p of this.peers(roleTag("phone"))) {
      const phone = this.meta(p);
      if (!socketMessageAllowed({
        role: "phone",
        userId: phone.userId,
        email: phone.email,
        emailVerified: phone.emailVerified,
        expMs: phone.expMs,
        allowedSubs: this.env.ALLOWED_SUBS,
        roomUsers: users,
        doorRole: phone.doorRole,
        assignedAgents: phone.assignedAgents,
        slug: phone.chatSlug,
        inDirectory: phone.inDirectory,
        enforce: this.enforce(),
        now,
      })) {
        p.close(4401, "unauthorized");
      }
    }
    if (this.enforce()) {
      await this.prunePush(users);
    }
  }

  private async indexRoom(slug: string): Promise<void> {
    const users = await this.roomUsers();
    const hash = allowHash(users);
    const prev = await this.ctx.storage.get<string>(ALLOW_HASH_KEY);
    if (prev === hash) {
      return;
    }
    if (await directoryRemember(this.env.DIRECTORY, slug, users)) {
      await this.ctx.storage.put(ALLOW_HASH_KEY, hash);
    }
  }

  private peers(tag: string): WebSocket[] {
    return collectTagged((name) => this.ctx.getWebSockets(name), tag);
  }

  private meta(ws: WebSocket): SocketMeta {
    return parseSocketTags(this.ctx.getTags(ws));
  }

  private async flush(ws: WebSocket, role: Role, userId?: string) {
    if (role === "phone") {
      const cmds = await this.ctx.storage.get<string>(CMDS_STORE_KEY);
      if (cmds) {
        ws.send(cmds);
      }
      // Goals board after cmds, before the thread: this human's if the crane
      // named them, else the room's.
      const aims = (userId ? await this.ctx.storage.get<string>(aimsStoreKey(userId)) : undefined)
        ?? await this.ctx.storage.get<string>(AIMS_STORE_KEY);
      if (aims) {
        ws.send(aims);
      }
      // Tasks board after aims — the crane's dial order is cmds, aims, todo.
      const todo = (userId ? await this.ctx.storage.get<string>(todoStoreKey(userId)) : undefined)
        ?? await this.ctx.storage.get<string>(TODO_STORE_KEY);
      if (todo) {
        ws.send(todo);
      }
      const storedTheme = knownTheme(await this.ctx.storage.get<string>(THEME_STORE_KEY));
      if (storedTheme) {
        ws.send(encodeThemeNotice(storedTheme));
      }
      const replayed = await this.sendTranscript(ws, userId);
      if (userId) {
        // Reactions ride after the bubbles they sit on; hydrate-tagged like them.
        const reactions = asReactions(await this.ctx.storage.get(reactionsStoreKey(userId)));
        for (const frame of reactionFramesFor(userId, reactions, replayed)) {
          ws.send(encodeFrame(frame));
        }
      }
      const items = await this.loadQueue();
      const cursor = userId ? await this.phoneCursor(userId) : 0;
      const take = peekFor(items, "phone", Date.now(), {
        userId,
        sinceSeq: cursor || undefined,
      });
      for (const m of take) {
        ws.send(stampOrderOnBody(m.body, { seq: m.seq, at: m.at }));
      }
      // Kit mid-answer for this human: put the bubble back. Not replay, not
      // stored; the same `draft` every mouth already paints (docs/frontends.md).
      if (userId) {
        const held = this.drafts.current(userId, Date.now());
        if (held) {
          ws.send(encodeFrame({ kind: "draft", user_id: userId, text: held }));
        }
      }
      return;
    }
    const items = await this.loadQueue();
    const { take } = drainFor(items, "crane", Date.now());
    for (const m of take) {
      ws.send(stampOrderOnBody(m.body, { seq: m.seq, at: m.at }));
      await this.deleteQueued(m);
    }
  }

  private async rememberPhone(msg: Queued): Promise<void> {
    await this.putQueued(msg);
    await this.putTranscript(msg);
  }

  private async putTranscript(msg: Queued): Promise<void> {
    if (!shouldTranscript(msg.kind)) {
      return;
    }
    const key = transcriptStoreKey(msg.userId);
    const cur = asTranscript(await this.ctx.storage.get(key));
    const next = appendTranscript(cur, msg);
    await this.ctx.storage.put(key, next);
  }

  /** This human's reload thread: personal rows over broadcasts, oldest first. */
  private async transcriptFor(userId?: string): Promise<Queued[]> {
    const personal = userId
      ? asTranscript(await this.ctx.storage.get(transcriptStoreKey(userId)))
      : [];
    const broadcasts = asTranscript(await this.ctx.storage.get(transcriptStoreKey("")));
    return hydrateTranscript(personal, broadcasts);
  }

  /** Replays the thread; returns the ids sent so reactions can follow. */
  private async sendTranscript(ws: WebSocket, userId?: string): Promise<string[]> {
    const rows = await this.transcriptFor(userId);
    for (const m of rows) {
      const ordered = stampOrderOnBody(m.body, { seq: m.seq, at: m.at });
      ws.send(stampReplayOnBody(ordered));
    }
    return rows.map((m) => m.id);
  }

  /** Keep a reaction only for a bubble hydrate will paint; clears delete. */
  private async storeReaction(r: Reaction): Promise<void> {
    const key = reactionsStoreKey(r.userId);
    const cur = asReactions(await this.ctx.storage.get(key));
    const keep = new Set((await this.transcriptFor(r.userId)).map((m) => m.id));
    const next = applyReaction(cur, r, keep);
    if (Object.keys(next).length) {
      await this.ctx.storage.put(key, next);
    } else {
      await this.ctx.storage.delete(key);
    }
  }

  private async loadQueue(): Promise<Queued[]> {
    const rows = await this.ctx.storage.list<Queued>({ prefix: QUEUE_STORE_PREFIX });
    const all = queuedFromList(rows);
    const now = Date.now();
    const live = pruneQueue(all, now);
    if (live.length !== all.length) {
      const keep = new Set(live.map((m) => queueIdentity(m)));
      for (const [key, m] of rows) {
        if (!keep.has(queueIdentity(m))) {
          await this.ctx.storage.delete(key);
        }
      }
    }
    return live;
  }

  private async putQueued(msg: Queued): Promise<void> {
    const seq = msg.seq ?? await this.nextSeq();
    const queued = { ...msg, seq };
    const items = await this.loadQueue();
    const next = enqueue(items, queued, { now: Date.now() });
    const nextKeys = new Set(next.map((m) => queueIdentity(m)));
    for (const m of items) {
      if (!nextKeys.has(queueIdentity(m))) {
        await this.deleteQueued(m);
      }
    }
    if (nextKeys.has(queueIdentity(queued))) {
      const stored = next.find((m) => queueIdentity(m) === queueIdentity(queued)) ?? queued;
      await this.ctx.storage.put(queueStoreKey(queued.id, queued.to), stored);
    }
  }

  private async nextSeq(): Promise<number> {
    const n = (await this.ctx.storage.get<number>(QUEUE_SEQ_KEY)) ?? 0;
    const seq = n + 1;
    await this.ctx.storage.put(QUEUE_SEQ_KEY, seq);
    return seq;
  }

  private async phoneCursor(userId: string): Promise<number> {
    return (await this.ctx.storage.get<number>(cursorStoreKey(userId))) ?? 0;
  }

  private async bumpCursor(userId: string | undefined, ackSeq?: number): Promise<void> {
    if (!userId) {
      return;
    }
    const key = cursorStoreKey(userId);
    const cur = (await this.ctx.storage.get<number>(key)) ?? 0;
    const next = mergeCursor(cur, ackSeq);
    if (next !== cur) {
      await this.ctx.storage.put(key, next);
    }
  }

  private async deleteQueued(item: Pick<Queued, "id" | "to">): Promise<void> {
    await this.ctx.storage.delete(queueStoreKey(item.id, item.to));
    await this.ctx.storage.delete(QUEUE_STORE_PREFIX + item.id);
  }

  private async ackPhoneId(id: string, userId?: string): Promise<void> {
    const items = await this.loadQueue();
    const hit = items.find((m) => m.id === id && m.to === "phone");
    if (!hit || !phoneMayDeleteQueued(hit, userId)) {
      return;
    }
    await this.deleteQueued(hit);
    await this.bumpCursor(userId, hit.seq);
  }

  private async dropAckedThrough(since: string, userId?: string): Promise<void> {
    const items = await this.loadQueue();
    const sinceSeq = seqForSince(items, since);
    await this.bumpCursor(userId, sinceSeq);
    const uid = userId ?? "";
    for (const m of items) {
      if (!phoneMayDeleteQueued(m, uid)) {
        continue;
      }
      if (sinceSeq != null && m.seq != null) {
        if (m.seq <= sinceSeq) {
          await this.deleteQueued(m);
        }
        continue;
      }
      if (m.id <= since) {
        await this.deleteQueued(m);
      }
    }
  }

  private async pushHttp(request: Request): Promise<Response> {
    const userId = request.headers.get("X-Chat-Sub")?.trim() ?? "";
    if (!userId) {
      return new Response("bad sub", { status: 400 });
    }
    const email = request.headers.get("X-Chat-Email")?.trim() || undefined;
    const emailVerified = request.headers.get("X-Chat-EmailVerified") === "1";
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return Response.json({ error: "bad frame" }, { status: 400 });
    }
    if (request.method === "PUT") {
      const parsed = parsePushPut(raw);
      if (!parsed) {
        return Response.json({ error: "bad frame" }, { status: 400 });
      }
      const mine = await this.loadPushFor(userId);
      const next = upsertPush(mine, {
        userId,
        email,
        emailVerified,
        subscription: parsed.subscription,
        at: Date.now(),
      });
      await this.writePush(userId, mine, next);
      return Response.json({ ok: true });
    }
    if (request.method === "DELETE") {
      const parsed = parsePushDelete(raw);
      if (!parsed) {
        return Response.json({ error: "bad frame" }, { status: 400 });
      }
      const mine = await this.loadPushFor(userId);
      const next = dropPush(mine, userId, parsed.endpoint);
      await this.writePush(userId, mine, next);
      return Response.json({ ok: true });
    }
    if (request.method === "POST") {
      // Round-trip test: a real card through the push service to this human's rows.
      if (!parsePushTest(raw)) {
        return Response.json({ error: "bad frame" }, { status: 400 });
      }
      const vapid = readVapid(this.env);
      if (!vapid) {
        return new Response(null, { status: 404 });
      }
      const slug = parseStoredSlug(await this.ctx.storage.get<string>(SLUG_STORE_KEY)) ?? "";
      const { counts, gone } = await testWebPush({
        title: slug,
        stored: await this.loadPushFor(userId),
        send: (subscription, payload) => sendWebPushDetailed({
          vapid,
          subscription,
          payload,
          fetch: bindWorkerFetch(),
        }),
      });
      for (const row of gone) {
        await this.ctx.storage.delete(pushStoreKey(row.userId, row.subscription.endpoint));
      }
      return Response.json(counts);
    }
    return new Response("method", { status: 405 });
  }

  private async notifyOffline(frame: WireFrame): Promise<void> {
    try {
      const vapid = readVapid(this.env);
      if (!vapid) {
        return;
      }
      const stored = await this.loadPushAll();
      const slug = parseStoredSlug(await this.ctx.storage.get<string>(SLUG_STORE_KEY)) ?? "";
      const { gone } = await fanWebPush({
        frame,
        title: displaySlug(slug),
        stored,
        send: (subscription, payload) => sendWebPush({
          vapid,
          subscription,
          payload,
          fetch: bindWorkerFetch(),
        }),
      });
      for (const row of gone) {
        await this.ctx.storage.delete(pushStoreKey(row.userId, row.subscription.endpoint));
      }
    } catch {
      // lock-screen is best-effort; the queue still holds the frame
    }
  }

  private async loadPushAll(): Promise<StoredPush[]> {
    const rows = await this.ctx.storage.list<StoredPush>({ prefix: PUSH_STORE_PREFIX });
    return [...rows.values()];
  }

  private async loadPushFor(userId: string): Promise<StoredPush[]> {
    const rows = await this.ctx.storage.list<StoredPush>({ prefix: `${PUSH_STORE_PREFIX}${userId}:` });
    return [...rows.values()];
  }

  private async writePush(userId: string, prev: StoredPush[], next: StoredPush[]): Promise<void> {
    const keep = new Set(next.map((row) => pushStoreKey(row.userId, row.subscription.endpoint)));
    for (const row of prev) {
      const key = pushStoreKey(row.userId, row.subscription.endpoint);
      if (!keep.has(key)) {
        await this.ctx.storage.delete(key);
      }
    }
    for (const row of next) {
      if (row.userId === userId) {
        await this.ctx.storage.put(pushStoreKey(row.userId, row.subscription.endpoint), row);
      }
    }
  }

  private async prunePush(users: RoomUser[]): Promise<void> {
    const all = await this.loadPushAll();
    const keep = prunePushForRoom(all, users, this.env);
    const keepKeys = new Set(keep.map((row) => pushStoreKey(row.userId, row.subscription.endpoint)));
    for (const row of all) {
      const key = pushStoreKey(row.userId, row.subscription.endpoint);
      if (!keepKeys.has(key)) {
        await this.ctx.storage.delete(key);
      }
    }
  }

  private async take(rateId: string, bytes: number): Promise<boolean> {
    const now = Date.now();
    const all = pruneDualLimits(
      (await this.ctx.storage.get<Record<string, DualLimit>>(RATE_KEY)) ?? {},
      now,
    );
    const got = takeFrame(all[rateId], now, bytes);
    all[rateId] = got.limits;
    await this.ctx.storage.put(RATE_KEY, all);
    return got.ok;
  }

  private async configHttp(request: Request): Promise<Response> {
    const loaded = await this.loadConfig();
    const house = houseKeys(this.env);
    if (request.method === "GET") {
      return Response.json(configView(loaded.config, loaded.startedEnv, house));
    }
    if (request.method === "PATCH") {
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return Response.json({ error: "bad_config" }, { status: 400 });
      }
      const applied = applyConfigPatch(loaded.config, raw, Date.now());
      if (!applied.ok) {
        return Response.json({ error: applied.error }, { status: 400 });
      }
      if (applied.changed) {
        if (applied.config.persona !== loaded.config.persona) {
          const refused = await this.writePersonaFile(filePersona, applied.config.persona);
          if (refused) {
            return refused;
          }
        }
        await this.ctx.storage.put(CONFIG_STORE_KEY, applied.config);
        await this.retargetBrain(loaded.config, applied.config);
      }
      return Response.json(configView(applied.config, loaded.startedEnv, house));
    }
    if (request.method === "POST") {
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return Response.json({ error: "bad_config" }, { status: 400 });
      }
      if (!raw || typeof raw !== "object" || (raw as { started?: unknown }).started !== true) {
        return Response.json({ error: "bad_config" }, { status: 400 });
      }
      const started = startedEnvFor(loaded.config);
      await this.ctx.storage.put(CONFIG_STARTED_KEY, started);
      return Response.json(configView(loaded.config, started, house));
    }
    return new Response("method", { status: 405 });
  }

  private async statusHttp(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("method", { status: 405 });
    }
    await this.ensureBrain();
    return Response.json(await this.loadStatus());
  }

  private async restartHttp(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("method", { status: 405 });
    }
    this.forgetBrain();
    await this.ensureBrain();
    return Response.json(await this.loadStatus());
  }

  private async pauseHttp(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("method", { status: 405 });
    }
    this.forgetBrain();
    await this.ctx.storage.deleteAlarm();
    return new Response(null, { status: 204 });
  }

  private async destroyHttp(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("method", { status: 405 });
    }
    this.forgetBrain();
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      // No alarm is fine.
    }
    await this.ctx.storage.deleteAll();
    return new Response(null, { status: 204 });
  }

  private async logHttp(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("method", { status: 405 });
    }
    const raw = new URL(request.url).searchParams.get("after");
    const after = raw == null || raw === "" ? 0 : Number(raw);
    if (!Number.isSafeInteger(after) || after < 0) {
      return Response.json({ error: "bad cursor" }, { status: 400 });
    }
    return Response.json(pageLog(await this.loadLog(), after));
  }

  private async loadConfig(): Promise<{ config: ReturnType<typeof parseConfig>; startedEnv: string | null }> {
    const started = await this.ctx.storage.get(CONFIG_STARTED_KEY);
    return {
      config: parseConfig(await this.ctx.storage.get(CONFIG_STORE_KEY)),
      startedEnv: typeof started === "string" ? started : null,
    };
  }

  private async loadStatus() {
    return parseStatus(await this.ctx.storage.get(STATUS_STORE_KEY));
  }

  private async loadLog() {
    return parseLog(await this.ctx.storage.get(LOG_STORE_KEY));
  }

  /** Config is the first frame on a crane socket. Phones never see it. */
  private async sendConfig(ws: WebSocket): Promise<void> {
    try {
      const { config } = await this.loadConfig();
      ws.send(configFrame(config, houseEnv(this.env)));
    } catch {
      // the crane redials
    }
  }

  /** Open the in-process harness so status reflects the registry boot, not an empty row. */
  private async ensureBrain(): Promise<void> {
    try {
      await this.nativeBrain();
    } catch (err) {
      await this.markBrainError(err);
    }
  }

  private async markBrainError(err: unknown): Promise<void> {
    const cur = await this.loadStatus();
    const message = err instanceof Error && err.message ? err.message : "harness failed";
    await this.ctx.storage.put(STATUS_STORE_KEY, {
      ...cur,
      state: "error",
      since: cur.since ?? Date.now(),
      version: cur.version,
      lastError: { message: message.slice(0, 500), at: new Date().toISOString() },
    });
  }

  private async stampBrainOpen(): Promise<void> {
    try {
      const cur = await this.loadStatus();
      await this.ctx.storage.put(STATUS_STORE_KEY, noteBrainOpen(cur, Date.now()));
    } catch {
      // presence is advisory
    }
  }

  private async foldHarness(message: string | ArrayBuffer): Promise<void> {
    try {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      const raw = JSON.parse(text) as unknown;
      const slug = parseStoredSlug(await this.ctx.storage.get<string>(SLUG_STORE_KEY));
      const folded = applyHarnessFrame(
        { status: await this.loadStatus(), log: await this.loadLog() },
        raw,
        Date.now(),
        slug,
      );
      await this.ctx.storage.put(STATUS_STORE_KEY, folded.status);
      await this.ctx.storage.put(LOG_STORE_KEY, folded.log);
      if (folded.samples.length) {
        this.later(this.emitSamples(folded.samples));
      }
    } catch {
      // a bad harness frame must not drop the socket
    }
  }

  private emitSamples(samples: SampleInput[]): Promise<void> {
    const sink = sampleSink(this.env);
    if (!sink) {
      return Promise.resolve();
    }
    return (async () => {
      for (const sample of samples) {
        try {
          await sink.addSample(sample);
        } catch {
          // spend is best-effort
        }
      }
    })();
  }

  private later(job: Promise<unknown>): void {
    const tracked = job.then(() => undefined, () => undefined);
    const wait = (this.ctx as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil;
    if (typeof wait === "function") {
      wait.call(this.ctx, tracked);
    }
  }

  /** First use connects the status row and publishes the harness's catalog. */
  private async nativeBrain(): Promise<Brain> {
    const slug = parseStoredSlug(await this.ctx.storage.get<string>(SLUG_STORE_KEY)) ?? "";
    await this.loadSeenOrigin();
    const catchUrl = oauthCatchRedirect(this.env, this.publicOrigin);
    let origin = "";
    if (catchUrl) {
      try {
        origin = new URL(catchUrl).origin;
      } catch {
        origin = "";
      }
    }
    const storedBearer = await this.ctx.storage.get<string>(BEARER_STORE_KEY);
    const roomBearer = typeof storedBearer === "string" && storedBearer.trim() ? storedBearer : "";
    const chat = origin && roomBearer && slug
      ? {
          origin,
          bearer: roomBearer,
          serve: (req: Request) => this.serveOwnChat(req),
        }
      : undefined;
    const harness = await openRoomBrain(this.ctx, this.env, {
      slug,
      foldLog: (frame) => {
        this.enqueueCrane(JSON.stringify(frame));
      },
      auth: {
        redirectUri: () => oauthCatchRedirect(this.env, this.publicOrigin),
        sealState: (plugin) => this.sealForSlash(plugin),
      },
      ...(chat ? { chat } : {}),
    });
    const fresh = harness !== this.harness;
    this.harness = harness;
    if (fresh) {
      await this.stampBrainOpen();
      await this.withEmit((emit) => harness.announce(emit));
      await this.armAlarm(harness.nextAlarm());
    }
    return harness;
  }

  private forgetBrain(): void {
    dropRoomBrain(this.ctx);
    this.harness = null;
  }

  private async retargetBrain(prev: AgentConfig, next: AgentConfig): Promise<void> {
    const envChanged = canonicalEnv(prev.env) !== canonicalEnv(next.env);
    const personaChanged = prev.persona !== next.persona;
    const mcpChanged = prev.mcp !== next.mcp;
    if (envChanged || personaChanged || mcpChanged) {
      this.forgetBrain();
      await this.nativeBrain();
    }
  }

  private async handToBrain(frame: WireFrame): Promise<void> {
    if (frame.kind !== "inbound" && frame.kind !== "react") {
      return;
    }
    const harness = await this.nativeBrain();
    const inbound: Inbound = { ...frame, kind: frame.kind, user_id: frame.user_id ?? "" };
    await this.withEmit((emit) => harness.handleInbound(inbound, emit));
    await this.armAlarm(harness.nextAlarm());
  }

  private enqueueCrane(body: string): void {
    const meta: SocketMeta = { role: "crane", rateId: "native" };
    this.craneChain = this.craneChain
      .then(() => undefined, () => undefined)
      .then(() => this.handleCraneFrame(body, meta));
  }

  private async withEmit(run: (emit: Emit) => Promise<void>): Promise<void> {
    const emit: Emit = (frame) => {
      this.enqueueCrane(JSON.stringify(frame));
    };
    await run(emit);
    await this.craneChain;
  }

  private async armAlarm(at: number | null): Promise<void> {
    if (at == null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const floor = Date.now() + ALARM_MIN_LEAD_MS;
    await this.ctx.storage.setAlarm(at < floor ? floor : at);
  }

  private async personaHttp(request: Request): Promise<Response> {
    const op = request.headers.get("X-Chat-Op");
    if (op === "persona_get" && request.method !== "GET") {
      return new Response("method", { status: 405 });
    }
    if (op === "persona_put" && request.method !== "PUT") {
      return new Response("method", { status: 405 });
    }
    if (op === "persona_delete" && request.method !== "DELETE") {
      return new Response("method", { status: 405 });
    }
    const store = await openPersonaStore(this.ctx, {
      foldLog: (frame) => {
        this.enqueueCrane(JSON.stringify(frame));
      },
    });
    if (op === "persona_get") {
      return Response.json({ files: store.list(), maxChars: MAX_CHARS });
    }
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return Response.json({ error: "bad_persona" }, { status: 400 });
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return Response.json({ error: "bad_persona" }, { status: 400 });
    }
    const body = raw as { name?: unknown; text?: unknown };
    const name = typeof body.name === "string" ? body.name : "";
    if (op === "persona_delete") {
      const refused = await this.writePersonaFile(name, null, store);
      if (refused) {
        return refused;
      }
      await this.notePersonaConfig(name, "");
      await this.reloadNative();
      return Response.json({ files: store.list(), maxChars: MAX_CHARS });
    }
    if (typeof body.text !== "string") {
      return Response.json({ error: "bad_persona" }, { status: 400 });
    }
    const refused = await this.writePersonaFile(name, body.text, store);
    if (refused) {
      return refused;
    }
    await this.notePersonaConfig(name, body.text);
    await this.reloadNative();
    return Response.json({ files: store.list(), maxChars: MAX_CHARS });
  }

  /**
   * Write or delete one persona file. `text === null` deletes.
   * Pass `store` when the caller already opened it (so import runs once).
   */
  private async writePersonaFile(name: string, text: string | null, store?: PersonaStore): Promise<Response | null> {
    try {
      const files = store ?? await openPersonaStore(this.ctx, {
        foldLog: (frame) => {
          this.enqueueCrane(JSON.stringify(frame));
        },
      });
      if (text === null) {
        files.remove(name);
      } else {
        files.write(name, text);
      }
      await this.craneChain;
      return null;
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      const code = message.includes("bytes") ? "too_long" : "bad_persona";
      return Response.json({ error: code }, { status: 400 });
    }
  }

  /** PERSONA.md is also the config string old clients still PATCH and read. */
  private async notePersonaConfig(name: string, text: string): Promise<void> {
    if (name !== filePersona) {
      return;
    }
    const loaded = await this.loadConfig();
    if (loaded.config.persona === text) {
      return;
    }
    await this.ctx.storage.put(CONFIG_STORE_KEY, { ...loaded.config, persona: text, updatedAt: Date.now() });
  }

  private async reloadNative(): Promise<void> {
    this.forgetBrain();
    await this.nativeBrain();
  }

  private async selfHttp(request: Request): Promise<Response> {
    const op = request.headers.get("X-Chat-Op");
    if (op === "self_get" && request.method !== "GET") {
      return new Response("method", { status: 405 });
    }
    if (op === "self_put" && request.method !== "PUT") {
      return new Response("method", { status: 405 });
    }
    const store = await openSelfStore(this.ctx, {
      foldLog: (frame) => {
        this.enqueueCrane(JSON.stringify(frame));
      },
    });
    if (op === "self_get") {
      return Response.json({ text: store.read(), maxChars });
    }
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return Response.json({ error: "bad_self" }, { status: 400 });
    }
    const text = raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as { text?: unknown }).text
      : undefined;
    if (typeof text !== "string") {
      return Response.json({ error: "bad_self" }, { status: 400 });
    }
    try {
      store.write(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("empty")) {
        return Response.json({ error: "empty" }, { status: 400 });
      }
      return Response.json({ error: "bad_self" }, { status: 400 });
    }
    await this.craneChain;
    return Response.json({ text: store.read(), maxChars });
  }

  private async authHttp(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("method", { status: 405 });
    }
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return Response.json({ error: "bad_auth" }, { status: 400 });
    }
    if (!raw || typeof raw !== "object") {
      return Response.json({ error: "bad_auth" }, { status: 400 });
    }
    const body = raw as { plugin?: unknown; code?: unknown; redirectUri?: unknown; userId?: unknown };
    const plugin = typeof body.plugin === "string" ? body.plugin.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const redirectUri = typeof body.redirectUri === "string" ? body.redirectUri.trim() : "";
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    if (!plugin || !code || !redirectUri) {
      return Response.json({ error: "bad_auth" }, { status: 400 });
    }
    const harness = await this.nativeBrain();
    try {
      await harness.authFinish(plugin, redirectUri, code);
    } catch (err) {
      return Response.json({ error: "auth_failed", message: authFailureMessage(err) }, { status: 502 });
    }
    if (userId && userId.length <= 128) {
      this.enqueueCrane(JSON.stringify({
        kind: "reply",
        user_id: userId,
        text: `${plugin} connected`,
      }));
      await this.craneChain;
    }
    return Response.json({ ok: true });
  }

  private async authStartHttp(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("method", { status: 405 });
    }
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return Response.json({ error: "bad_auth" }, { status: 400 });
    }
    if (!raw || typeof raw !== "object") {
      return Response.json({ error: "bad_auth" }, { status: 400 });
    }
    const body = raw as { plugin?: unknown; origin?: unknown; slug?: unknown };
    const plugin = typeof body.plugin === "string" ? body.plugin.trim() : "";
    if (!oauthRedirectPlugin(plugin)) {
      return Response.json({ error: "bad_plugin" }, { status: 400 });
    }
    const slug = await this.slugForAuth(typeof body.slug === "string" ? body.slug : "");
    if (!slug) {
      return Response.json({ error: "no_slug" }, { status: 400 });
    }
    if (typeof body.origin === "string") {
      await this.noteOrigin(body.origin);
    }
    const redirectUri = oauthCatchRedirect(this.env, this.publicOrigin);
    if (!redirectUri) {
      return Response.json({ error: "no_origin" }, { status: 503 });
    }
    const harness = await this.nativeBrain();
    let state: string;
    try {
      state = await this.sealPlugin(slug, plugin);
    } catch {
      return Response.json({ error: "login not configured" }, { status: 503 });
    }
    try {
      const started = await harness.authStart(plugin, redirectUri, state);
      if (!started?.url) {
        return Response.json({ error: "no_login" }, { status: 404 });
      }
      return Response.json({ url: started.url });
    } catch (err) {
      return Response.json({ error: "auth_failed", message: authFailureMessage(err) }, { status: 502 });
    }
  }

  private async slugForAuth(requested: string): Promise<string | null> {
    const asked = parseStoredSlug(requested);
    const stored = parseStoredSlug(await this.ctx.storage.get<string>(SLUG_STORE_KEY));
    if (asked && stored && asked !== stored) {
      return null;
    }
    const slug = asked ?? stored;
    if (!slug) {
      return null;
    }
    if (!stored) {
      await this.ctx.storage.put(SLUG_STORE_KEY, slug);
    }
    return slug;
  }

  private async sealForSlash(plugin: string): Promise<string> {
    const slug = parseStoredSlug(await this.ctx.storage.get<string>(SLUG_STORE_KEY)) ?? "";
    return this.sealPlugin(slug, plugin);
  }

  private async sealPlugin(slug: string, plugin: string): Promise<string> {
    if (!parseStoredSlug(slug)) {
      throw new Error("no slug");
    }
    const secret = this.env.SESSION_SECRET ?? "";
    if (secret.length < 32) {
      throw new Error("login not configured");
    }
    return sealOAuthCatch(await sessionKey(secret), { slug, plugin });
  }

  private async noteRequestOrigin(request: Request): Promise<void> {
    try {
      await this.noteOrigin(new URL(request.url).origin);
    } catch {
      // synthetic DO urls are not a public origin
    }
  }

  private async noteOrigin(raw: string): Promise<void> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return;
    }
    if (url.hostname === "agent" || url.hostname === "harness") {
      return;
    }
    if (this.publicOrigin === url.origin) {
      return;
    }
    this.publicOrigin = url.origin;
    await this.ctx.storage.put(PUBLIC_ORIGIN_KEY, url.origin);
  }

  private async loadSeenOrigin(): Promise<void> {
    if (this.publicOrigin) {
      return;
    }
    const stored = await this.ctx.storage.get<string>(PUBLIC_ORIGIN_KEY);
    if (typeof stored !== "string" || !stored) {
      return;
    }
    try {
      const url = new URL(stored);
      if (url.protocol === "http:" || url.protocol === "https:") {
        this.publicOrigin = url.origin;
      }
    } catch {
      // ignore a bad stored origin
    }
  }
}

const AUTH_SECRET = /client_secret|code_verifier|access_token|refresh_token|ya29\.|1\/\//;

/** One line for the catch page. Secrets and token material become a generic failure. */
function authFailureMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  const line = raw.replace(/\s+/g, " ").trim();
  if (!line || AUTH_SECRET.test(line)) {
    return "auth failed";
  }
  return line.slice(0, 240);
}

function sampleSink(env: AgentEnv): { addSample(input: SampleInput): Promise<unknown> } | null {
  const ns = env.SETTINGS as unknown as {
    getByName?: (name: string) => { addSample?: (input: SampleInput) => Promise<unknown> };
    idFromName?: (name: string) => unknown;
    get?: (id: unknown) => { addSample?: (input: SampleInput) => Promise<unknown> };
  } | undefined;
  if (!ns || typeof ns !== "object") {
    return null;
  }
  try {
    const stub = typeof ns.getByName === "function"
      ? ns.getByName("settings")
      : typeof ns.idFromName === "function" && typeof ns.get === "function"
        ? ns.get(ns.idFromName("settings"))
        : null;
    if (!stub || typeof stub.addSample !== "function") {
      return null;
    }
    return stub as { addSample(input: SampleInput): Promise<unknown> };
  } catch {
    return null;
  }
}
