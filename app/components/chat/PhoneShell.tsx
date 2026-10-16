"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FontSelect } from "../shared/FontSelect";
import { SettingsSelect } from "../shared/SettingsSelect";
import { ThemeSelect } from "../shared/ThemeSelect";
import type { SlashCommand } from "@/app/lib/slash";
import type { AimLink, AimRow } from "@/lib/chat/aims";
import { todoDoneCommand, type TodoItem } from "@/lib/chat/todo";
import { aimKey, type BoardSeen, changedRows, todoKey } from "@/lib/phone/boardSeen";
import { Compose } from "./Compose";
import { ConfigGapNote } from "./ConfigGapNote";
import { GeoEnable } from "./GeoEnable";
import { InstallApp } from "./InstallApp";
import { KitAvatar } from "./KitAvatar";
import { MicEnable } from "./MicEnable";
import { NotifyEnable } from "./NotifyEnable";
import { GoalsButton, GoalsSheet } from "./GoalsBoard";
import { TasksButton, TasksSheet } from "./TasksBoard";
import { AgentRoomControls } from "./AgentRoomControls";
import { SettingsMenu } from "./SettingsMenu";
import { bubbleFrom, Thread, type ChatBubble } from "./Thread";
import { mailboxUrl, parseIncoming } from "@/app/lib/socket";
import {
  ackSince,
  advanceCursor,
  capThread,
  cursorOf,
  failInThread,
  mergeThread,
  persistableThread,
  placeInThread,
  rememberSeen,
  sameThread,
} from "@/app/lib/thread";
import { loadThread, saveThread, threadCacheKey } from "@/app/lib/threadStore";
import { browserBumpBadge, browserClearBadge } from "@/app/lib/badge";
import { browserGeo } from "@/app/lib/geo";
import { browserBuzzPush } from "@/app/lib/haptic";
import { browserCloseShownNotify, browserNotifyIncoming } from "@/app/lib/notify";
import { browserRegisterPush, browserTestPush } from "@/app/lib/push";
import { browserSpeak } from "@/app/lib/tts";
import { isIos, isStandalone, signInHint } from "@/app/lib/install";
import { fileToPhoto } from "@/app/lib/photo";
import {
  browserAimsSeen,
  browserBackdropPref,
  browserFollowThemePref,
  browserGeoPref,
  browserLangPref,
  browserPhotoSizePref,
  browserTodoSeen,
  browserVoicePref,
  saveAimsSeen,
  saveBackdropPref,
  saveFollowThemePref,
  saveGeoPref,
  saveLangPref,
  savePhotoSizePref,
  saveTodoSeen,
  saveVoicePref,
} from "@/app/lib/prefs";
import { applyFont, fontFromQuery } from "@/app/lib/font";
import { RELEASE } from "@/app/lib/release";
import { applyTheme, cacheRoomTheme, cachedRoomTheme, paintTheme, parseTheme, THEME_KEY, themeFromQuery, type ThemeId } from "@/app/lib/theme";
import { landingCookie, landingPref, type LandingPref } from "@/lib/door/landing";
import { browserWakeLock, releaseScreenWake, type WakeLockSentinel } from "@/app/lib/wake";
import { authDeniedFromQuery, authRetryFromQuery } from "@/app/lib/install";
import { loginHref } from "@/app/lib/login";
import type { ConfigGap } from "./ConfigGapNote";
import { displaySlug, faceRevFromUnknown } from "@/lib/avatar/store";
import { backdropRevFromUnknown } from "@/lib/backdrop/store";
import { themeIdFromUnknown, isThemeNotice } from "@/lib/theme/store";
import { Backdrop } from "./Backdrop";
import { browserRecognizer } from "./HoldToTalk";
import { VoiceToggle } from "./VoiceToggle";
import { parseSlug } from "@/lib/chat/slug";
import type { RecognizerCtor } from "@/lib/phone/speech";
import { buildContext, wireContext } from "@/lib/phone/context";
import { GEO_TIMEOUT_MS, GEO_WARM_MS, cachedGeo, geoHint } from "@/lib/phone/geo";
import { DEFAULT_LANG, LANGUAGES, parseLang, speechLang, type LangId } from "@/lib/phone/lang";
import { DEFAULT_PHOTO_SIZE, PHOTO_SIZES, parsePhotoSize, photoEdge, type PhotoSizeId } from "@/lib/phone/photo";
import { describePhotoError, describeSendError } from "@/lib/phone/sendError";
import { speakFailHint, speakPhaseAfter, speakStatus, type SpeakPhase } from "@/lib/phone/speaker";
import { stripHarnessContext } from "@/lib/phone/text";
import {
  shouldDropMailboxOnHide,
  shouldReconnectMailbox,
  shouldRedialMailboxOnVisible,
} from "@/lib/phone/socketLife";
import { isPinnedToBottom, pinToBottom } from "@/lib/phone/threadScroll";
import { recoverViewport, viewportShellHeight } from "@/lib/phone/viewport";
import { encodeFrame, orderAt, orderSeq, type Role, type WireFrame } from "@/lib/chat/frame";
import { DRAFT_TTL_MS } from "@/lib/chat/draft";
import { parseReactionText } from "@/lib/chat/react";
import { connectSeenAck, seenAckForTurn } from "@/lib/chat/seen";
import { clearsTyping, TYPING_TTL_MS } from "@/lib/chat/typing";
import { nextMockReply, parseSample, sampleScene, type SampleId } from "@/app/lib/samples";

function chatLoginHref(slug: string | null | undefined): string {
  const s = slug ? parseSlug(slug) : null;
  return loginHref(s ? `/chat/${s}` : "/");
}

type AuthCfg = {
  mode: "spike" | "oidc" | null;
  google: boolean;
  dev?: boolean;
  gap?: ConfigGap | null;
  /** Worker publishes pocket voice (header mic + `/api/chat/tts`). Additive; missing is off. */
  voice?: boolean;
};
/** Door sends `agents`. `cranes` is only so older fixtures still list rooms. */
type Me = { sub: string; email?: string; role?: string; agents?: string[]; cranes?: string[] } | null;

function roomAgents(me: Me): string[] {
  if (!me) {
    return [];
  }
  if (Array.isArray(me.agents)) {
    return me.agents;
  }
  return me.cranes ?? [];
}

const BACKOFF_MS = 1000;
const BACKOFF_MAX = 30_000;
const ME_POLL_MS = 3_000;
const ME_POLL_MAX = 60_000;
const DRAFT_BUBBLE_ID = "__draft__";

type ClientFrame = {
  id?: string;
  since?: string;
  kind?: string;
  text?: string;
  images?: { url: string }[];
  context?: unknown;
  /** Phone `ack` only: the thread is on screen here (docs/frontends.md → Seen). */
  seen?: true;
};

function clientFrameId(frame: object): string | undefined {
  if (!("id" in frame)) {
    return undefined;
  }
  const id = frame.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function mintFrameId(n: number): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${n}`;
}

function sendClientFrame(ws: WebSocket, frame: ClientFrame): void {
  ws.send(encodeFrame(frame as WireFrame));
}

export function PhoneShell({ role = "phone", slug: routeSlug }: { role?: Role; slug?: string }) {
  const [slug, setSlug] = useState(() => (routeSlug ? parseSlug(routeSlug) ?? "" : ""));
  const [slugTouched, setSlugTouched] = useState(false);
  const [secret, setSecret] = useState("");
  const [bearer, setBearer] = useState("");
  const [cfg, setCfg] = useState<AuthCfg | null>(null);
  const [me, setMe] = useState<Me>(null);
  const [sampleId, setSampleId] = useState<SampleId | null>(null);
  const [status, setStatus] = useState<"idle" | "up" | "down">("idle");
  const [gpsHint, setGpsHint] = useState("GPS attaches on send if the OS allows it.");
  const [gpsOn, setGpsOn] = useState(true);
  const [photoSize, setPhotoSize] = useState<PhotoSizeId>(DEFAULT_PHOTO_SIZE);
  const [prefsReady, setPrefsReady] = useState(false);
  const [messages, setMessagesRaw] = useState<ChatBubble[]>([]);
  const [draft, setDraft] = useState("");
  const [stagedPhoto, setStagedPhoto] = useState<string | null>(null);
  const [sampleEmoji, setSampleEmoji] = useState(false);
  const [catalog, setCatalog] = useState<SlashCommand[]>([]);
  const [aims, setAims] = useState<AimRow[]>([]);
  const [aimLinks, setAimLinks] = useState<AimLink[]>([]);
  const [aimsSeen, setAimsSeen] = useState<BoardSeen>({});
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [todo, setTodo] = useState<TodoItem[]>([]);
  const [todoSeen, setTodoSeen] = useState<BoardSeen>({});
  const [tasksOpen, setTasksOpen] = useState(false);
  /** Ids whose `/todo done` went out; ticked in the drawer until the next board says. */
  const [todoPending, setTodoPending] = useState<number[]>([]);
  const [avatarRev, setAvatarRev] = useState(0);
  const [backdropRev, setBackdropRev] = useState(0);
  const [backdropOn, setBackdropOn] = useState(true);
  const [landing, setLanding] = useState<LandingPref>(null);
  const [followTheme, setFollowTheme] = useState(true);
  const [roomTheme, setRoomTheme] = useState<ThemeId | null>(null);
  const [faceHint, setFaceHint] = useState("");
  const [sendHint, setSendHint] = useState("");
  const [speakPhase, setSpeakPhase] = useState<SpeakPhase>("idle");
  const [copied, setCopied] = useState(false);
  const [meWait, setMeWait] = useState(false);
  const [googleHint, setGoogleHint] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const echoTimer = useRef(0);
  const echoCount = useRef(0);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const badgeRef = useRef(0);
  const pinConsumed = useRef(false);
  const sendPinRef = useRef<() => Promise<void>>(async () => {});
  const stoppedRef = useRef(true);
  const connectGen = useRef(0);
  const backoffRef = useRef(BACKOFF_MS);
  const reconnectTimer = useRef(0);
  const lastSeenId = useRef<string | undefined>(undefined);
  const lastSeenSeq = useRef(0);
  const seenIds = useRef(new Set<string>());
  const roomRef = useRef("");
  const hydratedKey = useRef("");
  const lastSaved = useRef<ChatBubble[]>([]);
  const idSeq = useRef(0);
  /** Turns typed while the socket is down. Flushed on the next open. */
  const unsentRef = useRef<ClientFrame[]>([]);
  const pinned = useRef(true);
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef(0);
  /**
   * Mouth-local draft expiry (docs/frontends.md → Draft). New words and
   * `typing` re-arm it; an identical re-sent draft does not. Runs through a
   * socket gap on purpose: the bubble stays, and a dead crane still clears.
   */
  const draftTimer = useRef(0);
  const draftText = useRef("");
  /** Armed by a hold-to-talk send; the next live `reply` is read aloud, then it disarms (docs/voice.md). */
  const awaitingVoice = useRef(false);
  /** Header mic. Off = typing (default). Detected after mount so SSR and hydration agree. */
  const [voiceOn, setVoiceOn] = useState(false);
  const [recognizer, setRecognizer] = useState<RecognizerCtor | null>(null);
  /** Settings → Language: what hold-to-talk hears and what Kit's voice speaks. The ref is for the socket closure. */
  const [lang, setLang] = useState<LangId>(DEFAULT_LANG);
  const langRef = useRef<LangId>(DEFAULT_LANG);
  const gpsOnRef = useRef(true);
  const followThemeRef = useRef(true);
  const geoWarm = useRef(false);
  const phone = role === "phone";
  const painting = Boolean(cfg?.dev && sampleId);
  const localEcho = Boolean(cfg?.dev && !sampleId && phone);

  function rememberCursor(id?: string, seq?: number) {
    const next = advanceCursor({ id: lastSeenId.current, seq: lastSeenSeq.current }, { id, seq });
    lastSeenId.current = next.id;
    lastSeenSeq.current = next.seq;
  }

  const stickThread = useCallback(() => {
    const node = scroller.current;
    if (!node || !pinned.current) {
      return;
    }
    pinToBottom(node);
  }, []);

  /** Your emoji on one of Kit's bubbles; empty clears. Paints at once, then tells the room. */
  function onReact(id: string, emoji: string) {
    const sock = wsRef.current;
    if (!sock || sock.readyState !== WebSocket.OPEN) {
      return;
    }
    setMessages((prev) => prev.map((m) => (
      m.id === id ? { ...m, reaction: emoji || undefined } : m
    )));
    sendClientFrame(sock, { kind: "react", id, text: emoji });
  }

  function onThreadScroll() {
    const node = scroller.current;
    if (!node) {
      return;
    }
    pinned.current = isPinnedToBottom(node);
  }

  function setMessages(update: ChatBubble[] | ((prev: ChatBubble[]) => ChatBubble[])) {
    if (typeof update === "function") {
      setMessagesRaw((prev) => capThread(update(prev)));
      return;
    }
    setMessagesRaw(capThread(update));
  }

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setSampleId(parseSample(q.get("sample")));
    const fromQuery = parseSlug(q.get("slug") ?? "");
    if (fromQuery) {
      setSlug(fromQuery);
      setSlugTouched(true);
    }
    const theme = themeFromQuery(q.get("theme"));
    if (theme) {
      saveFollowThemePref(false);
      followThemeRef.current = false;
      setFollowTheme(false);
      applyTheme(theme);
    }
    const font = fontFromQuery(q.get("font"));
    if (font) {
      applyFont(font);
    }
    setGoogleHint(signInHint({
      ios: isIos(navigator),
      standalone: isStandalone(window, navigator),
      retry: authRetryFromQuery(q),
      denied: authDeniedFromQuery(q),
    }));
  }, []);

  useEffect(() => {
    void (async () => {
      const [c, m, voiceUp] = await Promise.all([
        fetch("/api/auth/config").then(async (r) => r.ok ? r.json<AuthCfg>() : null).catch(() => null),
        fetch("/api/auth/me").then(async (r) => r.ok ? r.json<Me>() : null).catch(() => null),
        fetch("/api/chat/tts", { method: "GET" }).then((r) => r.ok).catch(() => false),
      ]);
      // No pendant config route on this origin: a door session is oidc.
      setCfg(c ?? { mode: "oidc", google: true, dev: false, gap: null, voice: voiceUp });
      setMe(m);
    })();
  }, []);

  useEffect(() => {
    const list = roomAgents(me);
    if (!phone || cfg?.mode !== "oidc" || !list.length) {
      return;
    }
    setSlug((cur) => {
      if (list.includes(cur)) {
        return cur;
      }
      if (slugTouched) {
        return cur;
      }
      return list[0] ?? cur;
    });
  }, [cfg?.mode, me, phone, slugTouched]);

  useEffect(() => {
    if (!cfg?.dev || !sampleId) {
      return;
    }
    const scene = sampleScene(sampleId, role);
    setMessages(scene.messages);
    setStatus(scene.status);
    setDraft(scene.draft ?? "");
    setCatalog(scene.catalog ?? []);
    setAims(scene.aims ?? []);
    setAimLinks(scene.aimLinks ?? []);
    setTodo(scene.todo ?? []);
    setTyping(Boolean(scene.typing));
    setSampleEmoji(Boolean(scene.emoji));
    if (scene.gpsHint) {
      setGpsHint(scene.gpsHint);
    }
  }, [cfg?.dev, sampleId, role]);

  useLayoutEffect(() => {
    stickThread();
    const node = scroller.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    const inner = node.firstElementChild;
    if (!inner) {
      return;
    }
    const ro = new ResizeObserver(() => {
      stickThread();
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [messages, stickThread]);

  useEffect(() => {
    setAvatarRev(0);
    setFaceHint("");
  }, [slug]);

  useEffect(() => {
    if (!phone) {
      setPrefsReady(true);
      return;
    }
    const on = browserGeoPref();
    gpsOnRef.current = on;
    setGpsOn(on);
    if (!on) {
      setGpsHint("GPS off");
    }
    setPhotoSize(browserPhotoSizePref());
    setBackdropOn(browserBackdropPref());
    setLanding(landingPref(document.cookie));
    const follow = browserFollowThemePref();
    followThemeRef.current = follow;
    setFollowTheme(follow);
    setRoomTheme(cachedRoomTheme());
    // Updater form: a constructor is a function, and setState would call it.
    setRecognizer(() => browserRecognizer());
    setVoiceOn(browserVoicePref());
    setAimsSeen(browserAimsSeen());
    setTodoSeen(browserTodoSeen());
    const tongue = browserLangPref();
    langRef.current = tongue;
    setLang(tongue);
    setPrefsReady(true);
  }, [phone]);

  // Looking at the drawer marks the board seen — on open, and when a new
  // board lands while it is open. The badge counts what differs from this.
  useEffect(() => {
    if (goalsOpen) {
      setAimsSeen(saveAimsSeen(aims));
    }
  }, [goalsOpen, aims]);
  useEffect(() => {
    if (tasksOpen) {
      setTodoSeen(saveTodoSeen(todo));
    }
  }, [tasksOpen, todo]);

  function pickLang(raw: string) {
    const next = parseLang(raw);
    saveLangPref(next);
    langRef.current = next;
    setLang(next);
  }

  function toggleVoice() {
    setVoiceOn((v) => {
      saveVoicePref(!v);
      return !v;
    });
  }

  useEffect(() => {
    return () => {
      window.clearTimeout(echoTimer.current);
      window.clearTimeout(typingTimer.current);
      window.clearTimeout(draftTimer.current);
      void releaseScreenWake(wakeRef.current);
    };
  }, []);

  useEffect(() => {
    if (!phone) {
      return;
    }
    function onVis() {
      if (document.hidden) {
        void releaseScreenWake(wakeRef.current);
        wakeRef.current = null;
      } else {
        badgeRef.current = browserClearBadge();
        recoverViewport(window);
      }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [phone]);

  useEffect(() => {
    if (!phone || typeof window === "undefined" || !window.visualViewport) {
      return;
    }
    const vv = window.visualViewport;
    function sync() {
      recoverViewport(window);
      const node = shellRef.current;
      const height = viewportShellHeight(vv.height);
      if (node && height) {
        node.style.height = height;
      }
    }
    sync();
    const el = shellRef.current;
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      if (el) {
        el.style.height = "";
      }
    };
  }, [phone]);

  const agents = roomAgents(me);
  const routeParsed = routeSlug ? parseSlug(routeSlug) : null;
  const roomSlug = (() => {
    if (!cfg) {
      return "";
    }
    if (!phone || cfg.mode !== "oidc" || cfg.dev) {
      return slug;
    }
    if (agents.includes(slug)) {
      return slug;
    }
    if (routeParsed && agents.includes(routeParsed)) {
      return routeParsed;
    }
    return agents[0] ?? "";
  })();
  const mailboxGap = Boolean(phone && cfg?.gap && !cfg.dev);
  const needGoogle = Boolean(
    phone && !mailboxGap && (
      (cfg?.dev && sampleId === "unsigned")
      || (Boolean(cfg?.google) && !me && !cfg?.dev)
    ),
  );
  const listed = !phone || cfg?.mode !== "oidc" || Boolean(cfg.dev)
    || (roomSlug !== "" && agents.includes(roomSlug));
  const waitingForAgent = Boolean(
    phone && cfg?.mode === "oidc" && !cfg.dev && me && !listed,
  );
  const canSocket = Boolean(cfg && roomSlug && listed && (cfg.mode === "spike" ? secret : phone ? me : bearer));
  // The on-device thread row: only for a room this phone is about to dial, never for a sample paint.
  const threadKey = phone && !painting && canSocket ? threadCacheKey(roomSlug, me?.sub) : "";

  useEffect(() => {
    const prev = roomRef.current;
    roomRef.current = roomSlug;
    if (!prev || prev === roomSlug) {
      return;
    }
    // A different room: its bubbles, cursor, dedup set, and staged photo are not this one's.
    seenIds.current.clear();
    lastSeenId.current = undefined;
    lastSeenSeq.current = 0;
    lastSaved.current = [];
    unsentRef.current = [];
    setMessagesRaw([]);
    setStagedPhoto(null);
  }, [roomSlug]);

  useEffect(() => {
    if (!threadKey) {
      return;
    }
    let dead = false;
    void loadThread(threadKey).then((cached) => {
      if (dead) {
        return;
      }
      hydratedKey.current = threadKey;
      lastSaved.current = cached;
      for (const m of cached) {
        rememberSeen(seenIds.current, m.id);
      }
      // Ack from what is already on the device so the mailbox skips what we hold.
      const next = advanceCursor({ id: lastSeenId.current, seq: lastSeenSeq.current }, cursorOf(cached));
      lastSeenId.current = next.id;
      lastSeenSeq.current = next.seq;
      // Always a fresh array: the write effect below must run once the row is read.
      setMessagesRaw((prev) => capThread(mergeThread(cached, prev)));
    });
    return () => {
      dead = true;
    };
  }, [threadKey]);

  useEffect(() => {
    // Write only after this room's row has been read, so a room switch cannot
    // file the old thread under the new key. Drafts and `sending` stay off disk.
    if (!threadKey || hydratedKey.current !== threadKey) {
      return;
    }
    const next = persistableThread(messages);
    if (sameThread(next, lastSaved.current)) {
      return;
    }
    lastSaved.current = next;
    void saveThread(threadKey, next);
  }, [messages, threadKey]);

  useEffect(() => {
    if (!phone || cfg?.mode !== "oidc" || !me || !listed || !roomSlug || needGoogle || mailboxGap || waitingForAgent) {
      return;
    }
    void browserRegisterPush(roomSlug);
  }, [phone, cfg?.mode, me, listed, roomSlug, needGoogle, mailboxGap, waitingForAgent]);

  useEffect(() => {
    if (!phone || cfg?.mode !== "oidc" || cfg.dev || listed || !me) {
      return;
    }
    let dead = false;
    let delay = ME_POLL_MS;
    let timer = 0;
    const load = () => {
      const want = parseSlug(slug);
      const q = want && slugTouched ? `?slug=${encodeURIComponent(want)}` : "";
      void fetch(`/api/auth/me${q}`)
        .then(async (r) => {
          if (r.status === 429) {
            setMeWait(true);
            delay = Math.min(delay * 2, ME_POLL_MAX);
            return null;
          }
          setMeWait(false);
          delay = ME_POLL_MS;
          return r.ok ? r.json<Me>() : null;
        })
        .then((m) => {
          if (dead || !m) {
            return;
          }
          setMe((prev) => {
            if (
              prev
              && prev.sub === m.sub
              && prev.email === m.email
              && JSON.stringify(roomAgents(prev)) === JSON.stringify(roomAgents(m))
            ) {
              return prev;
            }
            return m;
          });
        })
        .catch(() => undefined)
        .finally(() => {
          if (dead) {
            return;
          }
          timer = window.setTimeout(load, delay);
        });
    };
    load();
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, [cfg?.dev, cfg?.mode, listed, me, phone, slug, slugTouched]);

  const connect = useCallback(() => {
    if (stoppedRef.current || typeof window === "undefined" || !canSocket) {
      return;
    }
    if (shouldDropMailboxOnHide(role, document.visibilityState)) {
      return;
    }
    window.clearTimeout(reconnectTimer.current);
    reconnectTimer.current = 0;
    connectGen.current += 1;
    const gen = connectGen.current;
    const prev = wsRef.current;
    wsRef.current = null;
    if (prev) {
      prev.onopen = null;
      prev.onclose = null;
      prev.onerror = null;
      prev.onmessage = null;
      prev.close();
    }
    const url = mailboxUrl({
      host: window.location.host,
      protocol: window.location.protocol,
      slug: roomSlug,
      role,
      secret: cfg?.mode === "spike" ? secret : undefined,
      bearer: !phone && cfg?.mode === "oidc" ? bearer : undefined,
    });
    const ws = new WebSocket(url);
    wsRef.current = ws;
    const disarmDraft = () => {
      window.clearTimeout(draftTimer.current);
      draftTimer.current = 0;
      draftText.current = "";
    };
    const armDraft = () => {
      window.clearTimeout(draftTimer.current);
      draftTimer.current = window.setTimeout(() => {
        disarmDraft();
        setMessages((prev) => prev.filter((m) => m.id !== DRAFT_BUBBLE_ID));
      }, DRAFT_TTL_MS);
    };
    ws.onopen = () => {
      if (gen !== connectGen.current || stoppedRef.current) {
        return;
      }
      backoffRef.current = BACKOFF_MS;
      setStatus("up");
      const since = ackSince({ id: lastSeenId.current, seq: lastSeenSeq.current });
      if (phone) {
        // A phone socket is only up while the tab is visible: the cursor is seen, and our own tray is stale.
        sendClientFrame(ws, connectSeenAck(since));
        void browserCloseShownNotify();
      } else if (since) {
        sendClientFrame(ws, { kind: "ack", since });
      }
      const queued = unsentRef.current;
      unsentRef.current = [];
      for (const frame of queued) {
        sendClientFrame(ws, frame);
      }
    };
    ws.onclose = () => {
      if (gen !== connectGen.current || stoppedRef.current) {
        return;
      }
      setStatus("down");
      setTyping(false);
      // The draft stays: `reply` replaces it, the connect flush refreshes it,
      // a blank clears it, `draftTimer` expires it. Same as Cab `setUp(false)`.
      window.clearTimeout(typingTimer.current);
      typingTimer.current = 0;
      void releaseScreenWake(wakeRef.current);
      wakeRef.current = null;
      window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = 0;
      if (!shouldReconnectMailbox({
        role,
        visibilityState: document.visibilityState,
        stopped: stoppedRef.current,
      })) {
        return;
      }
      const delay = backoffRef.current;
      backoffRef.current = Math.min(delay * 2, BACKOFF_MAX);
      reconnectTimer.current = window.setTimeout(() => {
        if (stoppedRef.current) {
          return;
        }
        connect();
      }, delay);
    };
    ws.onmessage = (ev) => {
      if (gen !== connectGen.current || stoppedRef.current) {
        return;
      }
      const frame = parseIncoming(String(ev.data));
      if (!frame) {
        return;
      }
      const face = faceRevFromUnknown(frame);
      if (face) {
        setAvatarRev(face);
        return;
      }
      const backdrop = backdropRevFromUnknown(frame);
      if (backdrop != null) {
        setBackdropRev(backdrop);
        return;
      }
      if (isThemeNotice(frame)) {
        const next = themeIdFromUnknown(frame);
        if (next === "") {
          cacheRoomTheme(null);
          setRoomTheme(null);
          if (phone && followThemeRef.current) {
            paintTheme(parseTheme(window.localStorage.getItem(THEME_KEY)));
          }
        } else if (next) {
          cacheRoomTheme(next);
          setRoomTheme(next);
          if (phone && followThemeRef.current) {
            paintTheme(next);
          }
        }
        return;
      }
      if (frame.kind === "cmds") {
        setCatalog(frame.commands ?? []);
        return;
      }
      if (frame.kind === "aims") {
        // The goals board, latest wins; an empty one clears (docs/frontends.md → Aims board).
        setAims(frame.aims ?? []);
        setAimLinks(frame.links ?? []);
        return;
      }
      if (frame.kind === "todo") {
        // The tasks board, latest wins; a fresh list settles any ticked rows.
        setTodo(frame.todo ?? []);
        setTodoPending([]);
        return;
      }
      if (frame.kind === "typing") {
        if (phone) {
          setTyping(true);
          window.clearTimeout(typingTimer.current);
          typingTimer.current = window.setTimeout(() => {
            setTyping(false);
            typingTimer.current = 0;
          }, TYPING_TTL_MS);
          if (draftText.current) {
            armDraft();
          }
        }
        return;
      }
      if (frame.kind === "draft") {
        if (!phone) {
          return;
        }
        const text = frame.text ?? "";
        if (!text.trim()) {
          disarmDraft();
        } else if (text !== draftText.current) {
          draftText.current = text;
          armDraft();
        }
        setMessages((prev) => {
          const rest = prev.filter((m) => m.id !== DRAFT_BUBBLE_ID);
          if (!text.trim()) {
            return rest;
          }
          const prevDraft = prev.find((m) => m.id === DRAFT_BUBBLE_ID);
          return placeInThread(rest.map((m) => (m.live ? { ...m, live: false } : m)), {
            id: DRAFT_BUBBLE_ID,
            from: "kit",
            text,
            kind: "draft",
            at: prevDraft?.at ?? Date.now(),
            live: true,
          });
        });
        return;
      }
      if (phone && clearsTyping(frame.kind)) {
        setTyping(false);
        window.clearTimeout(typingTimer.current);
        typingTimer.current = 0;
      }
      if (phone && frame.kind === "reply") {
        disarmDraft();
      }
      const id = clientFrameId(frame);
      const seq = orderSeq(frame.seq);
      const at = orderAt(frame.at);
      if (frame.kind === "ack") {
        if (phone && frame.seen) {
          // Another of this human's mouths has the thread on screen: our tray card is read.
          void browserCloseShownNotify();
        }
        if (id) {
          setMessages((prev) => prev.map((m) => (
            m.id === id ? { ...m, pending: false } : m
          )));
        }
        return;
      }
      if (frame.kind === "error") {
        // Refusal, not a turn: mark our bubble and never paint it as Kit or move the cursor.
        awaitingVoice.current = false;
        setMessages((prev) => failInThread(prev, id, describeSendError(frame.text)));
        return;
      }
      if (frame.kind === "react") {
        // An emoji on a bubble we already have; `id` names it. Not a turn: no cursor, no toast.
        if (id) {
          const reaction = parseReactionText(frame.text) ?? "";
          setMessages((prev) => prev.map((m) => (
            m.id === id ? { ...m, reaction: reaction || undefined } : m
          )));
        }
        return;
      }
      if (id) {
        rememberCursor(id, seq);
        if (seenIds.current.has(id)) {
          setMessages((prev) => {
            const hit = prev.find((m) => m.id === id);
            if (!hit) {
              return prev;
            }
            const nextSeq = seq ?? hit.seq;
            const nextAt = at ?? hit.at;
            if (nextSeq === hit.seq && nextAt === hit.at) {
              return prev;
            }
            return placeInThread(prev, { ...hit, seq: nextSeq, at: nextAt });
          });
          return;
        }
        rememberSeen(seenIds.current, id);
      }
      setMessages((prev) => {
        const fromDraft = frame.kind === "reply" && prev.some((m) => m.id === DRAFT_BUBBLE_ID);
        const rest = frame.kind === "reply"
          ? prev.filter((m) => m.id !== DRAFT_BUBBLE_ID)
          : prev;
        const cleared = rest.map((m) => (m.live ? { ...m, live: false } : m));
        return placeInThread(cleared, {
          id: id ?? `${Date.now()}-${cleared.length}`,
          from: bubbleFrom(phone, frame.kind),
          text: frame.text ?? "",
          kind: frame.kind,
          at: at ?? Date.now(),
          seq,
          photo: frame.images?.[0]?.url,
          live: fromDraft,
        });
      });
      if (phone) {
        void releaseScreenWake(wakeRef.current);
        wakeRef.current = null;
        if (frame.replay !== true) {
          browserBuzzPush(frame.kind);
          badgeRef.current = browserBumpBadge(badgeRef.current, frame.kind);
          browserNotifyIncoming({
            kind: frame.kind,
            title: displaySlug(roomSlug),
            text: frame.text,
            photo: Boolean(frame.images?.[0]?.url),
          });
          const seen = seenAckForTurn({ kind: frame.kind, id, replay: frame.replay }, document.visibilityState === "visible");
          if (seen) {
            sendClientFrame(ws, seen);
          }
          // Finished turns only: not draft / typing, not hydrate, not a cron push, not a sibling's inbound.
          if (frame.kind === "reply" && awaitingVoice.current) {
            awaitingVoice.current = false;
            void browserSpeak(frame.text ?? "", {
              lang: langRef.current,
              onPhase: (ev) => {
                setSpeakPhase(speakPhaseAfter(ev));
                if (ev.phase === "failed") {
                  const why = speakFailHint(ev.reason);
                  if (why) {
                    setSendHint(why);
                  }
                }
              },
            });
          }
        }
      }
    };
  }, [bearer, canSocket, cfg?.mode, phone, role, roomSlug, secret]);

  useEffect(() => {
    if (!canSocket || painting) {
      return;
    }
    stoppedRef.current = false;
    backoffRef.current = BACKOFF_MS;
    connect();
    function dropPhoneSocket() {
      window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = 0;
      const sock = wsRef.current;
      if (sock && sock.readyState === WebSocket.OPEN) {
        sock.close();
      }
    }
    function onVis() {
      if (stoppedRef.current) {
        return;
      }
      if (shouldDropMailboxOnHide(role, document.visibilityState)) {
        dropPhoneSocket();
        return;
      }
      if (shouldRedialMailboxOnVisible(role, document.visibilityState)) {
        connect();
        return;
      }
      if (document.visibilityState !== "visible") {
        return;
      }
      const sock = wsRef.current;
      if (sock && sock.readyState === WebSocket.OPEN) {
        return;
      }
      connect();
    }
    function onFreeze() {
      if (stoppedRef.current || role !== "phone") {
        return;
      }
      dropPhoneSocket();
    }
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onVis);
    document.addEventListener("freeze", onFreeze);
    return () => {
      stoppedRef.current = true;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onVis);
      document.removeEventListener("freeze", onFreeze);
      window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = 0;
      connectGen.current += 1;
      const sock = wsRef.current;
      wsRef.current = null;
      if (sock) {
        sock.onopen = null;
        sock.onclose = null;
        sock.onerror = null;
        sock.onmessage = null;
        sock.close();
      }
    };
  }, [canSocket, connect, painting, role]);

  useEffect(() => {
    if (painting || canSocket || !localEcho) {
      return;
    }
    setStatus("up");
  }, [painting, canSocket, localEcho]);

  useEffect(() => {
    if (!phone || painting || !prefsReady || status !== "up" || pinConsumed.current) {
      return;
    }
    const q = new URLSearchParams(window.location.search);
    if (q.get("pin") !== "1") {
      return;
    }
    pinConsumed.current = true;
    q.delete("pin");
    const qs = q.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    void sendPinRef.current();
  }, [phone, painting, prefsReady, status]);

  async function dropWake() {
    await releaseScreenWake(wakeRef.current);
    wakeRef.current = null;
  }

  async function takeWake() {
    await dropWake();
    wakeRef.current = await browserWakeLock();
  }

  async function warmGps() {
    if (!phone || !gpsOnRef.current || geoWarm.current) {
      return;
    }
    geoWarm.current = true;
    const geo = await browserGeo(GEO_WARM_MS);
    if (!gpsOnRef.current) {
      geoWarm.current = false;
      return;
    }
    if (!geo.ok && geo.reason === "unavailable") {
      geoWarm.current = false;
    }
    setGpsHint(geoHint(true, geo));
  }

  async function phoneContext(wantGeo: boolean, opts?: { timeoutMs?: number; cachedOnly?: boolean; spoken?: boolean }) {
    const timeoutMs = opts?.timeoutMs ?? GEO_TIMEOUT_MS;
    let geo: Awaited<ReturnType<typeof browserGeo>>;
    if (!wantGeo) {
      geo = { ok: false, reason: "unavailable" };
    } else if (opts?.cachedOnly) {
      const hit = cachedGeo();
      geo = hit ? { ok: true, geo: hit } : { ok: false, reason: "unavailable" };
    } else {
      geo = await browserGeo(timeoutMs);
    }
    // `surface: browser` on every PWA turn so the crane's `[surface]` stamp can tell the pocket from the dash.
    return {
      geo,
      context: wireContext(buildContext({
        geo: geo.ok ? geo.geo : null,
        surface: "browser",
        input: opts?.spoken ? "spoken" : undefined,
      })),
    };
  }

  /** `spoken`: hold-to-talk words. Same inbound frame plus `context.input`, and the reply gets read aloud. */
  async function sendText(text: string, photo?: string, send?: { spoken?: boolean }) {
    const wantGeo = phone && gpsOn;
    const trimmed = stripHarnessContext(text).trim();
    const waitAck = canSocket && !painting;
    const outbound = Boolean(trimmed || photo);
    if (outbound) {
      idSeq.current += 1;
    }
    const id = outbound ? mintFrameId(idSeq.current) : undefined;
    if (id) {
      rememberSeen(seenIds.current, id);
    }
    if (outbound && id) {
      setSendHint("");
      setStagedPhoto(null);
      pinned.current = true;
      setMessages((prev) => placeInThread(prev, {
        id,
        from: phone ? "you" : "kit",
        text: trimmed,
        at: Date.now(),
        photo,
        pending: waitAck ? true : undefined,
      }));
    }
    if (phone) {
      recoverViewport(window);
    }
    const spoken = Boolean(phone && outbound && send?.spoken);
    const { geo, context } = phone
      ? await phoneContext(wantGeo, { cachedOnly: true, spoken })
      : { geo: { ok: false as const, reason: "unavailable" as const }, context: undefined };
    if (spoken) {
      awaitingVoice.current = true;
    }
    if (phone) {
      if (!wantGeo || geo.ok || !geoWarm.current) {
        setGpsHint(geoHint(wantGeo, geo));
      }
      badgeRef.current = browserClearBadge();
      void takeWake();
    }
    const frame: ClientFrame = {
      id,
      text: trimmed || undefined,
      kind: phone ? "inbound" : "reply",
      images: photo ? [{ url: photo }] : undefined,
      context,
    };
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      sendClientFrame(wsRef.current, frame);
    } else if (canSocket && !painting) {
      unsentRef.current.push(frame);
    }
    if (localEcho && !canSocket && !painting && (trimmed || photo)) {
      const n = echoCount.current;
      echoCount.current += 1;
      window.clearTimeout(echoTimer.current);
      echoTimer.current = window.setTimeout(() => {
        setMessages((prev) => placeInThread(prev, {
          id: `${Date.now()}-echo`,
          from: "kit",
          text: nextMockReply(n),
          at: Date.now(),
        }));
        void dropWake();
      }, 400);
    }
  }

  async function sendPin() {
    if (!phone || !gpsOn) {
      if (phone && !gpsOn) {
        setGpsHint("GPS off");
      }
      return;
    }
    const { geo, context } = await phoneContext(true, { timeoutMs: GEO_WARM_MS });
    setGpsHint(geoHint(true, geo));
    if (!geo.ok) {
      return;
    }
    const frame = { kind: "pin" as const, context };
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(encodeFrame(frame));
    }
  }
  sendPinRef.current = sendPin;

  function toggleGps() {
    setGpsOn((on) => {
      const next = !on;
      saveGeoPref(next);
      gpsOnRef.current = next;
      geoWarm.current = false;
      setGpsHint(next ? "GPS attaches on send if the OS allows it." : "GPS off");
      if (next) {
        void warmGps();
      }
      return next;
    });
  }

  function pickPhotoSize(raw: string) {
    const next = parsePhotoSize(raw);
    savePhotoSizePref(next);
    setPhotoSize(next);
  }

  function pickHumanTheme() {
    saveFollowThemePref(false);
    followThemeRef.current = false;
    setFollowTheme(false);
  }

  function setFollow(next: boolean) {
    saveFollowThemePref(next);
    followThemeRef.current = next;
    setFollowTheme(next);
    if (next) {
      const room = cachedRoomTheme();
      if (room) {
        paintTheme(room);
      }
    } else {
      applyTheme(parseTheme(document.documentElement.getAttribute("data-theme")));
    }
  }

  /** Settings → Open this chat on entry: `/` comes straight here instead of the console or the picker. */
  const landHere = landing?.slug === roomSlug;
  function toggleLandHere() {
    const next: LandingPref = landHere ? null : { slug: roomSlug };
    document.cookie = landingCookie(next);
    setLanding(next);
  }

  /** One switch for both agent-driven looks: the room theme and the backdrop. Off = your theme on a plain canvas. */
  const agentStyle = followTheme && backdropOn;
  function toggleAgentStyle() {
    const next = !agentStyle;
    saveBackdropPref(next);
    setBackdropOn(next);
    setFollow(next);
  }

  /**
   * Encode now, send later: the ladder runs while the caption is typed, a bad
   * file is refused on the spot, and Send carries caption + photo as one turn.
   */
  async function stagePhoto(file: File) {
    setSendHint("");
    const got = await fileToPhoto(file, { edge: photoEdge(photoSize) });
    if (!got.ok) {
      setSendHint(describePhotoError(got.error));
      return;
    }
    setStagedPhoto(got.url);
  }

  async function copyIdentity() {
    const bits = [me?.email, me?.sub].filter((v): v is string => Boolean(v));
    try {
      await navigator.clipboard.writeText(bits.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const title = useMemo(
    () => waitingForAgent || mailboxGap || !roomSlug ? "Agent" : displaySlug(roomSlug),
    [waitingForAgent, mailboxGap, roomSlug],
  );
  const hideSecrets = painting;
  const faceAuth = hideSecrets
    ? {}
    : {
        secret: cfg?.mode === "spike" ? secret || undefined : undefined,
        bearer: !phone && cfg?.mode === "oidc" ? bearer || undefined : undefined,
      };
  const canEditFace = Boolean(listed && roomSlug) && !needGoogle && !waitingForAgent && !mailboxGap;

  const faceProps = {
    slug: listed ? roomSlug : "",
    rev: avatarRev,
    editable: canEditFace,
    onRev: setAvatarRev,
    onError: setFaceHint,
    ...faceAuth,
  };
  const backdropProps = {
    slug: listed ? roomSlug : "",
    rev: backdropRev,
    ...faceAuth,
  };

  let mouth: ReactNode;
  if (needGoogle) {
    mouth = (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <KitAvatar {...faceProps} size="lg" editable={false} />
        <p className="text-sm text-body">Sign in with Google to talk.</p>
        <a className="rounded-xl border border-accent-line bg-accent-soft px-4 py-2 text-sm text-mark" href={chatLoginHref(slugTouched ? slug : null)}>
          Continue with Google
        </a>
        {googleHint
          ? <p className="max-w-xs text-xs text-dim">{googleHint}</p>
          : null}
      </main>
    );
  } else if (mailboxGap && cfg?.gap) {
    mouth = (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <KitAvatar {...faceProps} size="lg" editable={false} />
        <ConfigGapNote gap={cfg.gap} />
      </main>
    );
  } else if (waitingForAgent) {
    mouth = (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <KitAvatar {...faceProps} size="lg" editable={false} />
        <p className="text-sm text-body">
          {agents.length
            ? `Not on ${roomSlug ? displaySlug(roomSlug) : "that agent"} yet`
            : "Not on any agent yet — give this to an admin"}
        </p>
        {me?.email
          ? <p className="text-sm text-fg">{me.email}</p>
          : null}
        <p className="break-all font-mono text-xs text-muted">{me?.sub}</p>
        {meWait
          ? <p className="text-xs text-dim">give it a minute</p>
          : null}
        <button
          type="button"
          className="rounded-xl border border-accent-line bg-accent-soft px-4 py-2 text-sm text-mark"
          onClick={() => void copyIdentity()}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </main>
    );
  } else {
    mouth = (
      <>
        <div className="relative flex min-h-0 flex-1 flex-col">
          {phone && backdropOn ? <Backdrop {...backdropProps} /> : null}
          <div
            ref={scroller}
            className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
            onScroll={onThreadScroll}
          >
            <Thread
              messages={messages}
              onReact={phone ? onReact : undefined}
              empty={(
                <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                  <KitAvatar {...faceProps} size="lg" editable={false} />
                  <p className="text-chat text-dim">
                    Nothing yet. Type below — or / for commands.
                  </p>
                </div>
              )}
            />
          </div>
        </div>
        {faceHint
          ? <p className="shrink-0 border-t border-danger-line bg-danger-soft px-3 py-1.5 text-xs text-danger">{faceHint}</p>
          : null}
        {sendHint
          ? <p role="alert" className="shrink-0 border-t border-danger-line bg-danger-soft px-3 py-1.5 text-xs text-danger">{sendHint}</p>
          : null}
        <Compose
          key={`${sampleId ?? "live"}:${draft}:${sampleEmoji ? "emoji" : ""}`}
          disabled={painting && status !== "up"}
          placeholder={phone ? `Message ${title} · / for commands` : "Reply as the agent"}
          gpsHint={phone ? gpsHint : undefined}
          gpsOn={gpsOn}
          onGpsToggle={phone ? toggleGps : undefined}
          commands={phone}
          catalog={catalog}
          initialText={draft}
          initialEmoji={sampleEmoji}
          onSend={(t) => void sendText(t, stagedPhoto ?? undefined)}
          voice={phone && voiceOn && Boolean(cfg?.voice)}
          recognizer={phone ? recognizer : null}
          lang={phone ? speechLang(lang) : undefined}
          onVoice={phone && cfg?.voice ? (t) => void sendText(t, stagedPhoto ?? undefined, { spoken: true }) : undefined}
          speaking={speakPhase}
          onPhoto={phone ? (f) => void stagePhoto(f) : undefined}
          photo={phone ? stagedPhoto : undefined}
          onPhotoClear={phone ? () => setStagedPhoto(null) : undefined}
          onPin={phone ? () => void sendPin() : undefined}
          onEngage={phone ? () => void warmGps() : undefined}
        />
      </>
    );
  }

  return (
    <div ref={shellRef} className="flex h-dvh flex-col overflow-hidden bg-canvas pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" data-shot={phone ? "phone" : "agent"}>
      <header className="relative z-20 flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative z-20 h-10 w-20 shrink-0">
            <div className="absolute -left-0.5 -top-1">
              <KitAvatar {...faceProps} size="xl" className="border-2 border-line" />
            </div>
          </div>
          <div className="min-w-0">
            <p className="truncate text-chat font-medium text-fg">{title}</p>
            <p className="text-[11px] text-dim">
              <span className={status === "up" ? "text-ok" : "text-dim"}>
                {status === "up" ? "live" : status === "down" ? "down" : "idle"}
              </span>
              {status === "up" && typing ? " · typing…" : null}
              {speakStatus(speakPhase)
                ? <span className="animate-pulse text-ok">{` · ${speakStatus(speakPhase)}`}</span>
                : null}
              {cfg?.dev && !painting ? " · dev" : null}
              {phone ? null : " · stand-in"}
            </p>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <InstallApp placement="header" />
          {phone
            ? (
                <GoalsButton
                  count={aims.length}
                  changes={changedRows(aims, aimsSeen, aimKey)}
                  open={goalsOpen}
                  onToggle={() => setGoalsOpen((v) => !v)}
                />
              )
            : null}
          {phone
            ? (
                <TasksButton
                  count={todo.length}
                  changes={changedRows(todo, todoSeen, todoKey)}
                  open={tasksOpen}
                  onToggle={() => setTasksOpen((v) => !v)}
                />
              )
            : null}
          {phone && cfg?.voice && recognizer
            ? <VoiceToggle on={voiceOn} speaking={speakPhase === "playing"} onToggle={toggleVoice} />
            : null}
          <SettingsMenu>
            <div className="flex flex-col gap-2">
              <InstallApp placement="block" signInFirst={needGoogle} />
              {phone
                ? (
                    <div className="flex flex-col gap-1.5 border-b border-line pb-2">
                      <span className="text-xs text-muted">Access</span>
                      {cfg?.voice ? <MicEnable /> : null}
                      <GeoEnable sending={gpsOn} onToggle={toggleGps} />
                      <NotifyEnable
                        onGranted={() => browserRegisterPush(roomSlug)}
                        onTest={cfg?.mode === "oidc" ? () => browserTestPush(roomSlug) : undefined}
                      />
                    </div>
                  )
                : null}
              {phone && cfg?.mode === "oidc" && agents.length
                ? (
                    <SettingsSelect
                      label="Agent"
                      value={slug}
                      options={agents.map((c) => ({ id: c, label: displaySlug(c) }))}
                      onChange={(id) => {
                        setSlugTouched(true);
                        setSlug(id);
                      }}
                    />
                  )
                : null}
              {cfg?.mode === "spike" && !hideSecrets
                ? (
                    <label className="flex flex-col gap-1 text-xs text-muted">
                      Agent access secret
                      <input
                        type="password"
                        autoComplete="off"
                        className="w-full rounded border border-edge bg-canvas px-1.5 py-1 text-sm text-fg"
                        value={secret}
                        onChange={(e) => setSecret(e.target.value)}
                      />
                    </label>
                  )
                : null}
              {!phone && cfg?.mode === "oidc" && !hideSecrets
                ? (
                    <label className="flex flex-col gap-1 text-xs text-muted">
                      Agent access token
                      <input
                        type="password"
                        autoComplete="off"
                        className="w-full rounded border border-edge bg-canvas px-1.5 py-1 text-sm text-fg"
                        value={bearer}
                        onChange={(e) => setBearer(e.target.value)}
                      />
                    </label>
                  )
                : null}
              {needGoogle
                ? null
                : (
                    <>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted">Theme</span>
                        <ThemeSelect
                          onHumanPick={phone ? pickHumanTheme : undefined}
                          roomTheme={phone ? roomTheme : null}
                          followTheme={phone ? followTheme : false}
                          agentName={roomSlug ? displaySlug(roomSlug) : "Agent"}
                        />
                      </div>
                      {phone
                        ? (
                            <div className="flex flex-col gap-1">
                              <label className="flex items-center gap-2 text-xs text-muted">
                                <input type="checkbox" checked={agentStyle} onChange={toggleAgentStyle} />
                                {`Let ${title} style the chat`}
                              </label>
                              <p className="text-[11px] text-dim">{`${title} picks the color theme and can paint a wallpaper behind the thread. Off keeps your theme on a plain canvas.`}</p>
                            </div>
                          )
                        : null}
                    </>
                  )}
              <FontSelect />
              {phone && cfg?.voice
                ? (
                    <SettingsSelect
                      label="Language"
                      value={lang}
                      options={LANGUAGES}
                      onChange={pickLang}
                      hint={`Hold to talk listens, and ${title} speaks, in this language.`}
                    />
                  )
                : null}
              {phone
                ? (
                    <SettingsSelect
                      label="Photo size"
                      value={photoSize}
                      options={PHOTO_SIZES.map((s) => ({ id: s.id, label: `${s.label} · ${s.edge} px` }))}
                      onChange={pickPhotoSize}
                      hint="Smaller sends faster and costs fewer tokens to look at."
                    />
                  )
                : null}
              {phone && me
                ? (
                    <div className="flex flex-col gap-1 border-t border-line pt-2">
                      <label className="flex items-center gap-2 text-xs text-muted">
                        <input type="checkbox" checked={landHere} onChange={toggleLandHere} />
                        Open this chat on entry
                      </label>
                      <p className="text-[11px] text-dim">Visiting gantree lands here instead of the console. Settings can turn it off too.</p>
                    </div>
                  )
                : null}
              {phone && roomSlug && listed && cfg?.mode === "oidc" && me
                ? <AgentRoomControls slug={roomSlug} />
                : null}
              {(cfg?.dev || (cfg?.google && phone))
                ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2">
                      {cfg?.dev
                        ? phone
                          ? <a className="text-xs text-dim underline" href="/chat">Open chat</a>
                          : <a className="text-xs text-dim underline" href="/">Open phone</a>
                        : null}
                      {cfg?.google && phone && !cfg.gap
                        ? (
                            me
                              ? (
                                  <form action="/api/auth/logout" method="post">
                                    <button type="submit" className="text-xs text-dim underline">sign out</button>
                                  </form>
                                )
                              : <a className="text-xs text-mark underline" href="/login">sign in</a>
                          )
                        : null}
                    </div>
                  )
                : null}
              <p className="border-t border-line pt-2 text-[11px] text-faint" title="gantree version">
                {RELEASE}
              </p>
            </div>
          </SettingsMenu>
        </div>
      </header>
      {goalsOpen
        ? (
            <GoalsSheet
              aims={aims}
              links={aimLinks}
              onClose={() => setGoalsOpen(false)}
              onAsk={(command) => void sendText(command)}
            />
          )
        : null}
      {tasksOpen
        ? (
            <TasksSheet
              todo={todo}
              pending={todoPending}
              onClose={() => setTasksOpen(false)}
              onDone={(id) => {
                setTodoPending((p) => (p.includes(id) ? p : [...p, id]));
                void sendText(todoDoneCommand(id));
              }}
              onSend={(text) => void sendText(text)}
            />
          )
        : null}
      {mouth}
    </div>
  );
}
