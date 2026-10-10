import type { AimLink, AimRow } from "@/lib/chat/aims";
import type { SlashCommand } from "@/lib/chat/cmds";
import type { Role } from "@/lib/chat/frame";
import type { TodoItem } from "@/lib/chat/todo";

export const DEV_USER = {
  sub: "118212345678901234567",
  email: "ada@example.com",
  cranes: ["ada"],
};

export const SAMPLE_IDS = [
  "unsigned",
  "empty",
  "cmds",
  "thread",
  "ping",
  "photo",
  "down",
  "crane",
  "stream",
  "emoji",
] as const;

export type SampleId = (typeof SAMPLE_IDS)[number];

export type SampleBubble = {
  id: string;
  from: "you" | "kit";
  text: string;
  kind?: string;
  at: number;
  photo?: string;
  reaction?: string;
};

export type SampleScene = {
  id: SampleId;
  messages: SampleBubble[];
  status: "idle" | "up" | "down";
  gpsHint?: string;
  draft?: string;
  catalog?: SlashCommand[];
  /** Goals board rows, as the crane `aims` frame would carry them. */
  aims?: AimRow[];
  aimLinks?: AimLink[];
  /** Tasks board rows, as the crane `todo` frame would carry them. */
  todo?: TodoItem[];
  typing?: boolean;
  emoji?: boolean;
};

export const SAMPLE_LINES = {
  threadYou: "On the dock — is the gate still open?",
  threadKitLatch: "Gate's on the latch until 21:00. I'll ping you at 20:40 if you're still out.",
  threadYouLeave: "Leave by 20:50 then.",
  threadKit: "Leave-by 20:50. Pin is this-send, ±12m.",
  ping: "20:40 — still on the dock? Gate latches in twenty.",
  pingYou: "Walking back.",
  pingKit: "I'll hush.",
  photoYou: "This the right hatch?",
  photoKit: "Yes — port side, yellow tape. Don't step the wet plate.",
  craneKit: "Gate's on the latch until 21:00.",
  streamDraft: "⏳ Gate's on the latch until 21:00. I'll ping you at…",
} as const;

/** Shot/loopback stand-in only. Live catalog comes from the crane cmds frame. */
export const SAMPLE_COMMANDS: SlashCommand[] = [
  { name: "new", hint: "reset this session's history" },
  { name: "status", hint: "uptime, model, history, tools, turns" },
  { name: "brief", hint: "hold a prefix ~6h", args: true },
];

/** Shot/loopback stand-in only. Live board comes from the crane aims frame. */
export const SAMPLE_AIMS: AimRow[] = [
  {
    area: "training",
    sentence: "Gym three mornings a week through spring.",
    rating30: 1.4,
    sum7: 6,
    streak: 2,
    note: "asked",
    days: [
      { day: "2026-09-22", score: 2, events: [411] },
      { day: "2026-09-23", score: -1, events: [413] },
      { day: "2026-09-24", score: 0, events: [] },
      { day: "2026-09-25", score: 3, events: [415] },
      { day: "2026-09-26", score: 2, events: [418] },
    ],
    weeks: [
      { start: "2026-07-26", mean: -0.4, up: 1, against: 3, metrics: [] },
      { start: "2026-08-02", mean: 0.1, up: 2, against: 2, metrics: [] },
      { start: "2026-08-09", mean: 0.6, up: 3, against: 1, metrics: [] },
      { start: "2026-08-16", mean: 0.3, up: 2, against: 1, metrics: [] },
      { start: "2026-08-23", mean: 1.0, up: 4, against: 0, metrics: [] },
      { start: "2026-08-30", mean: 0.7, up: 3, against: 1, metrics: [] },
      { start: "2026-09-06", mean: 1.3, up: 4, against: 0, metrics: [] },
      { start: "2026-09-13", mean: 0.9, up: 3, against: 1, metrics: [] },
      { start: "2026-09-20", mean: 1.4, up: 4, against: 1, metrics: [] },
    ],
    slope: 0.3,
    block: { days: 10, up: 4, against: 2, mean: 0.4, pct: 0.4 },
  },
  {
    area: "weight",
    sentence: "Under 190 by the first climbing trip.",
    rating30: 0.6,
    sum7: 1,
    streak: 0,
    note: "",
    days: [
      { day: "2026-09-22", score: 0, events: [414] },
      { day: "2026-09-23", score: -1, events: [412] },
      { day: "2026-09-24", score: 0, events: [] },
      { day: "2026-09-25", score: 0, events: [] },
      { day: "2026-09-26", score: 2, events: [419] },
    ],
    weeks: [
      { start: "2026-08-02", mean: 0.0, up: 1, against: 1, metrics: [{ metric: "weight", mean: 193.4, unit: "lb", n: 2 }] },
      { start: "2026-08-09", mean: 0.3, up: 2, against: 1, metrics: [{ metric: "weight", mean: 193.0, unit: "lb", n: 3 }] },
      { start: "2026-08-16", mean: -0.1, up: 1, against: 2, metrics: [{ metric: "weight", mean: 193.2, unit: "lb", n: 2 }] },
      { start: "2026-08-23", mean: 0.6, up: 3, against: 0, metrics: [{ metric: "weight", mean: 192.4, unit: "lb", n: 3 }] },
      { start: "2026-08-30", mean: 0.4, up: 2, against: 1, metrics: [{ metric: "weight", mean: 192.1, unit: "lb", n: 2 }] },
      { start: "2026-09-06", mean: 0.9, up: 3, against: 0, metrics: [{ metric: "weight", mean: 191.6, unit: "lb", n: 3 }] },
      { start: "2026-09-13", mean: 0.7, up: 3, against: 1, metrics: [{ metric: "weight", mean: 191.9, unit: "lb", n: 2 }] },
      { start: "2026-09-20", mean: 0.6, up: 2, against: 1, metrics: [{ metric: "weight", mean: 191.4, unit: "lb", n: 3 }] },
    ],
    slope: 0.1,
    effect: { a: "weight", b: "", metric: "weight", r: -0.42, n: 8 },
  },
];

/** Cross-aim next-day lines, as `links` on the same frame. */
export const SAMPLE_AIM_LINKS: AimLink[] = [
  { a: "training", b: "weight", r: 0.38, n: 12 },
];

/** The pocket list, oldest first, as the crane `todo` frame carries it (docs/tasks.md §4.4). The drawer sorts by the marker. */
export const SAMPLE_TODO: TodoItem[] = [
  { id: 420, slug: "amazon", text: "return the box", at: "2026-09-17" },
  { id: 412, slug: "dentist", text: "call to book a cleaning", at: "2026-09-23" },
  { id: 418, slug: "passport", text: "! renew, Wed 11am", at: "2026-09-26" },
];

export const MOCK_REPLIES = [
  "Heard. I'll watch the latch.",
  "Pin updated. Gate is still on until 21:00.",
  "Ok — ping at 20:40 if you're still out.",
] as const;

/** Schematic hatch — mock photo, not a real capture. */
export const MOCK_PHOTO
  = "data:image/svg+xml;charset=utf-8,"
    + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
  <rect width="320" height="200" fill="#1c1917"/>
  <rect x="40" y="28" width="240" height="128" rx="10" fill="#3f2e14" stroke="#a16207" stroke-width="3"/>
  <circle cx="160" cy="92" r="20" fill="#6ee7b7"/>
  <text x="160" y="180" text-anchor="middle" fill="#a8a29e" font-size="14" font-family="sans-serif">hatch · mock</text>
</svg>`,
    );

function bubble(
  id: string,
  from: "you" | "kit",
  text: string,
  extra: Partial<SampleBubble> = {},
): SampleBubble {
  return { id, from, text, at: extra.at ?? 1, ...extra };
}

export function parseSample(v: unknown): SampleId | null {
  return typeof v === "string" && (SAMPLE_IDS as readonly string[]).includes(v)
    ? (v as SampleId)
    : null;
}

export function nextMockReply(sentCount: number): string {
  const i = sentCount % MOCK_REPLIES.length;
  return MOCK_REPLIES[i] ?? MOCK_REPLIES[0];
}

export function sampleScene(id: SampleId, role: Role): SampleScene {
  if (id === "unsigned") {
    return { id, messages: [], status: "idle" };
  }
  if (id === "empty") {
    return {
      id,
      messages: [],
      status: "up",
      gpsHint: role === "phone" ? "GPS attaches on send if the OS allows it." : undefined,
    };
  }
  if (id === "cmds") {
    return {
      id,
      messages: [],
      status: "up",
      gpsHint: role === "phone" ? "GPS attaches on send if the OS allows it." : undefined,
      draft: "/",
      catalog: SAMPLE_COMMANDS,
    };
  }
  if (id === "down") {
    return {
      id,
      messages: [bubble("d1", "you", SAMPLE_LINES.threadYou, { at: 1 })],
      status: "down",
      gpsHint: role === "phone" ? "GPS omitted (denied or unavailable)" : undefined,
    };
  }
  if (id === "ping") {
    return {
      id,
      messages: [
        bubble("p1", "kit", SAMPLE_LINES.ping, { kind: "push", at: 1 }),
        bubble("p2", "you", SAMPLE_LINES.pingYou, { at: 2 }),
        bubble("p3", "kit", SAMPLE_LINES.pingKit, { at: 3 }),
      ],
      status: "up",
      gpsHint: role === "phone" ? "pin ±12m this send" : undefined,
    };
  }
  if (id === "photo") {
    return {
      id,
      messages: [
        bubble("h1", "you", SAMPLE_LINES.photoYou, { at: 1, photo: MOCK_PHOTO }),
        bubble("h2", "kit", SAMPLE_LINES.photoKit, { at: 2 }),
      ],
      status: "up",
      gpsHint: role === "phone" ? "pin ±8m this send" : undefined,
    };
  }
  if (id === "crane") {
    return {
      id,
      messages: [
        bubble("c1", "you", SAMPLE_LINES.threadYou, { at: 1 }),
        bubble("c2", "kit", SAMPLE_LINES.craneKit, { at: 2 }),
      ],
      status: "up",
    };
  }
  const thread: SampleScene = {
    id: "thread",
    messages: [
      bubble("t1", "you", SAMPLE_LINES.threadYou, { at: 1 }),
      bubble("t2", "kit", SAMPLE_LINES.threadKitLatch, { at: 2, kind: "reply", reaction: "🙏" }),
      bubble("t3", "you", SAMPLE_LINES.threadYouLeave, { at: 3, kind: "inbound", reaction: "👍" }),
      bubble("t4", "kit", SAMPLE_LINES.threadKit, { at: 4, kind: "reply" }),
    ],
    aims: SAMPLE_AIMS,
    aimLinks: SAMPLE_AIM_LINKS,
    todo: SAMPLE_TODO,
    status: "up",
    gpsHint: role === "phone" ? "pin ±12m this send" : undefined,
  };
  if (id === "stream") {
    return {
      id,
      messages: [
        bubble("s1", "you", SAMPLE_LINES.threadYou, { at: 1 }),
        bubble("s2", "kit", SAMPLE_LINES.streamDraft, { kind: "draft", at: 2 }),
      ],
      status: "up",
      typing: true,
      gpsHint: role === "phone" ? "pin ±12m this send" : undefined,
    };
  }
  if (id === "emoji") {
    return { ...thread, id, emoji: true };
  }
  return thread;
}
