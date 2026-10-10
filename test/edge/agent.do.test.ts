import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIG_STORE_KEY } from "@/lib/agents/config";
import { verifySnapshot } from "@/lib/agents/snapshot";
import { HELD_DRAFT_TTL_MS } from "@/lib/chat/draft";
import type { WireFrame } from "@/lib/chat/frame";
import { QUEUE_STORE_PREFIX, type Queued } from "@/lib/chat/queue";
import { socketTags } from "@/lib/chat/tags";
import { PUSH_STORE_PREFIX } from "@/lib/chat/push/subscription";
import { encodeBase64Url, generateVapidKeys } from "@/lib/chat/push/vapid";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    protected ctx: unknown;
    protected env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

vi.stubGlobal("WebSocketRequestResponsePair", class {
  constructor(readonly request: string, readonly response: string) {}
});

const { Agent } = await import("@/edge/agent.do");

const OPEN = 1;
const CLOSING = 2;

/** Mirrors workerd: `send()` on a socket past OPEN throws synchronously. */
class FakeSocket {
  readyState = OPEN;
  sent: string[] = [];

  send(body: string): void {
    if (this.readyState !== OPEN) {
      throw new TypeError("Can't call WebSocket send() after close().");
    }
    this.sent.push(body);
  }

  close(): void {
    this.readyState = CLOSING;
  }

  frames(): WireFrame[] {
    return this.sent.map((s) => JSON.parse(s) as WireFrame);
  }

  kinds(): (string | undefined)[] {
    return this.frames().map((f) => f.kind);
  }
}

class FakeStorage {
  rows = new Map<string, unknown>();

  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.rows.get(key) as T | undefined);
  }

  put(key: string, value: unknown): Promise<void> {
    this.rows.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.rows.delete(key));
  }

  list<T>(opts?: { prefix?: string }): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    const keys = [...this.rows.keys()].sort((a, b) => a.localeCompare(b));
    for (const k of keys) {
      if (!opts?.prefix || k.startsWith(opts.prefix)) {
        out.set(k, this.rows.get(k) as T);
      }
    }
    return Promise.resolve(out);
  }

  queued(): Queued[] {
    return [...this.rows.entries()]
      .filter(([k]) => k.startsWith(QUEUE_STORE_PREFIX))
      .map(([, v]) => v as Queued);
  }
}

/**
 * Enough of `DurableObjectState` for the mailbox. Like the real thing,
 * `getWebSockets` keeps listing a socket after `close()` until the peer
 * answers — that half-open socket is the one an unguarded fan trips over.
 */
class FakeState {
  storage = new FakeStorage();
  private readonly sockets: { ws: FakeSocket; tags: string[] }[] = [];

  setWebSocketAutoResponse(): void {}

  acceptWebSocket(ws: FakeSocket, tags: string[]): void {
    this.sockets.push({ ws, tags });
  }

  getWebSockets(tag?: string): FakeSocket[] {
    return this.sockets.filter((s) => tag == null || s.tags.includes(tag)).map((s) => s.ws);
  }

  getTags(ws: FakeSocket): string[] {
    return this.sockets.find((s) => s.ws === ws)?.tags ?? [];
  }
}

type Ctx = ConstructorParameters<typeof Agent>[0];
type Flushable = { flush(ws: FakeSocket, role: "phone" | "crane", userId?: string): Promise<void> };

function room(env: Record<string, unknown> = {}) {
  const state = new FakeState();
  const box = new Agent(state as unknown as Ctx, env);
  const crane = new FakeSocket();
  state.acceptWebSocket(crane, socketTags({ role: "crane", rateId: "bearer:kit" }));
  const phone = (sub: string): FakeSocket => {
    const ws = new FakeSocket();
    state.acceptWebSocket(ws, socketTags({ role: "phone", rateId: `sub:${sub}`, userId: sub }));
    return ws;
  };
  const say = (ws: FakeSocket, frame: object): Promise<void> =>
    box.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(frame));
  const connect = (ws: FakeSocket, sub?: string): Promise<void> =>
    (box as unknown as Flushable).flush(ws, "phone", sub);
  return { state, box, crane, phone, say, connect };
}

describe("Agent fan-out", () => {
  it("skips a half-open sibling socket so the live one still gets typing, draft, reply", async () => {
    const { crane, phone, say } = room();
    const stale = phone("1182");
    stale.close(); // Cab's cancel()ed sweep socket, still listed by getWebSockets
    const live = phone("1182");

    await say(crane, { kind: "typing", user_id: "1182" });
    await say(crane, { kind: "draft", user_id: "1182", text: "Looks like" });
    await say(crane, { kind: "reply", user_id: "1182", text: "Looks like rain." });

    expect(stale.sent).toEqual([]);
    expect(live.kinds()).toEqual(["typing", "draft", "reply"]);
    expect(live.frames()[2]?.text).toBe("Looks like rain.");
  });

  it("survives a socket that reports OPEN but throws on send", async () => {
    const { crane, phone, say } = room();
    const flaky = phone("1182");
    flaky.send = () => {
      throw new TypeError("Can't call WebSocket send() after close().");
    };
    const live = phone("1182");

    await expect(say(crane, { kind: "draft", user_id: "1182", text: "Hello" })).resolves.toBeUndefined();
    await say(crane, { kind: "reply", user_id: "1182", text: "Hello there." });

    expect(live.kinds()).toEqual(["draft", "reply"]);
  });

  it("queues for the crane when every crane socket is stale, not just when none is listed", async () => {
    const { state, crane, phone, say } = room();
    crane.close();
    const ada = phone("1182");

    await say(ada, { id: "m1", text: "are you there" });

    const forCrane = state.storage.queued().filter((q) => q.to === "crane");
    expect(forCrane).toHaveLength(1);
    expect(forCrane[0]?.body).toContain("are you there");
    expect(ada.kinds()).toEqual(["ack"]);
  });

  it("announces a room notice past a stale socket", async () => {
    const { state, box, phone } = room();
    const stale = phone("1182");
    stale.close();
    const live = phone("7");

    const res = await box.fetch(new Request("https://agent/", {
      method: "PUT",
      headers: { "X-Chat-Op": "theme", "content-type": "application/json" },
      body: JSON.stringify({ theme: "siren" }),
    }));

    expect(res.ok).toBe(true);
    expect(stale.sent).toEqual([]);
    expect(live.frames()).toEqual([{ kind: "theme", theme: "siren" }]);
    expect(state.storage.rows.get("theme")).toBe("siren");
  });

  it("reads a retired room theme as cleared and does not flush it", async () => {
    const { state, box, phone, connect } = room();
    await state.storage.put("theme", "noir");

    const got = await box.fetch(new Request("https://agent/", {
      method: "GET",
      headers: { "X-Chat-Op": "theme" },
    }));
    expect(got.ok).toBe(true);
    expect((await got.json<{ theme: string | null }>()).theme).toBeNull();

    const refused = await box.fetch(new Request("https://agent/", {
      method: "PUT",
      headers: { "X-Chat-Op": "theme", "content-type": "application/json" },
      body: JSON.stringify({ theme: "noir" }),
    }));
    expect(refused.status).toBe(400);

    const ada = phone("1182");
    await connect(ada, "1182");
    expect(ada.sent.join("\n")).not.toContain('"kind":"theme"');
  });
});

describe("Agent junk frames", () => {
  it("drops a blank draft when no draft is held", async () => {
    const { crane, phone, say } = room();
    const ada = phone("1182");

    await say(crane, { kind: "draft", user_id: "1182" });
    await say(crane, { kind: "draft", user_id: "1182", text: "   " });

    expect(ada.sent).toEqual([]);
  });

  it("forwards a blank draft as the clear while a draft is held, then forgets it", async () => {
    const { crane, phone, say, connect } = room();
    const ada = phone("1182");

    await say(crane, { kind: "draft", user_id: "1182", text: "Looks like" });
    await say(crane, { kind: "draft", user_id: "1182" }); // crane Discard: cancel / empty turn
    await say(crane, { kind: "draft", user_id: "1182", text: " " }); // second blank: nothing held, noise

    expect(ada.frames()).toEqual([
      { kind: "draft", user_id: "1182", text: "Looks like" },
      { kind: "draft", user_id: "1182", text: "" },
    ]);

    const back = phone("1182");
    await connect(back, "1182");
    expect(back.sent).toEqual([]);
  });

  it("refuses an empty reply as a bad frame and stores nothing", async () => {
    const { state, crane, phone, say } = room();
    const ada = phone("1182");

    await say(crane, { kind: "reply", user_id: "1182", id: "r9", text: "  " });

    expect(crane.frames()).toEqual([{ kind: "error", text: "bad frame", id: "r9" }]);
    expect(ada.sent).toEqual([]);
    expect(state.storage.rows.size).toBe(0);
  });

  it("still passes a reply that is only a photo", async () => {
    const { crane, phone, say } = room();
    const ada = phone("1182");

    await say(crane, { kind: "reply", user_id: "1182", images: [{ url: "https://cdn.example/rain.jpg" }] });

    expect(ada.kinds()).toEqual(["reply"]);
    expect(ada.frames()[0]?.images?.[0]?.url).toBe("https://cdn.example/rain.jpg");
  });
});

describe("Agent harness rate", () => {
  it("does not spend the crane's bucket on typing or draft", async () => {
    const { crane, phone, say } = room();
    const ada = phone("1182");

    for (let i = 0; i < 40; i += 1) {
      await say(crane, { kind: "typing", user_id: "1182" });
      await say(crane, { kind: "draft", user_id: "1182", text: `token ${i}` });
    }
    await say(crane, { kind: "reply", user_id: "1182", text: "done" });

    expect(crane.sent).toEqual([]);
    expect(ada.kinds().at(-1)).toBe("reply");
    expect(ada.kinds().filter((k) => k === "typing")).toHaveLength(40);
  });

  it("still meters turns", async () => {
    const { crane, phone, say } = room();
    phone("1182");

    for (let i = 0; i < 30; i += 1) {
      await say(crane, { kind: "reply", user_id: "1182", text: `turn ${i}` });
    }
    expect(crane.sent).toEqual([]);
    await say(crane, { kind: "reply", user_id: "1182", text: "one more" });
    expect(crane.frames()).toEqual([{ kind: "error", text: "rate" }]);
  });
});

describe("Agent seen acks", () => {
  it("copies a phone's seen ack to that human's other mouths, not the sender, not another human", async () => {
    const { crane, phone, say } = room();
    const pwa = phone("1182");
    const cab = phone("1182");
    const bob = phone("7");

    await say(pwa, { kind: "ack", since: "4", seen: true });

    expect(cab.frames()).toEqual([{ kind: "ack", seen: true, user_id: "1182", since: "4" }]);
    expect(pwa.sent).toEqual([]);
    expect(bob.sent).toEqual([]);
    expect(crane.frames()).toEqual([{ kind: "ack", since: "4", seen: true, user_id: "1182" }]);
  });

  it("keeps a bare seen ack away from the crane", async () => {
    const { crane, phone, say } = room();
    const pwa = phone("1182");
    const cab = phone("1182");

    await say(pwa, { kind: "ack", seen: true });

    expect(cab.frames()).toEqual([{ kind: "ack", seen: true, user_id: "1182" }]);
    expect(crane.sent).toEqual([]);
  });

  it("never copies a plain delivery ack", async () => {
    const { crane, phone, say } = room();
    const pwa = phone("1182");
    const cab = phone("1182");

    await say(pwa, { kind: "ack", since: "4" });
    await say(pwa, { kind: "ack", id: "m1" });

    expect(cab.sent).toEqual([]);
    expect(crane.kinds()).toEqual(["ack", "ack"]);
  });

  it("acks a seen reply id for the phone like any ack", async () => {
    const { state, crane, phone, say } = room();
    const pwa = phone("1182");
    await say(crane, { kind: "reply", id: "r1", user_id: "1182", text: "Rain." });
    expect(state.storage.queued().some((q) => q.id === "r1" && q.to === "phone")).toBe(true);

    await say(pwa, { kind: "ack", id: "r1", seen: true });

    expect(state.storage.queued().some((q) => q.id === "r1")).toBe(false);
  });
});

describe("Agent held draft", () => {
  it("hands the latest draft back to a phone that connects mid-answer", async () => {
    const { crane, phone, say, connect } = room();
    await say(crane, { kind: "draft", user_id: "1182", text: "Looks" });
    await say(crane, { kind: "draft", user_id: "1182", text: "Looks like rain" });

    const back = phone("1182");
    await connect(back, "1182");
    expect(back.frames()).toEqual([{ kind: "draft", user_id: "1182", text: "Looks like rain" }]);

    const other = phone("7");
    await connect(other, "7");
    expect(other.sent).toEqual([]);

    const anon = phone("");
    await connect(anon);
    expect(anon.sent).toEqual([]);
  });

  it("forgets the draft once the reply lands", async () => {
    const { crane, phone, say, connect } = room();
    await say(crane, { kind: "draft", user_id: "1182", text: "Looks like" });
    await say(crane, { kind: "reply", user_id: "1182", text: "Looks like rain." });

    const back = phone("1182");
    await connect(back, "1182");

    expect(back.kinds()).not.toContain("draft");
    expect(back.frames().some((f) => f.kind === "reply" && f.text === "Looks like rain.")).toBe(true);
  });

  it("forgets the draft on an error for that human", async () => {
    const { crane, phone, say, connect } = room();
    await say(crane, { kind: "draft", user_id: "1182", text: "Looks like" });
    await say(crane, { kind: "error", user_id: "1182", text: "tool failed" });

    const back = phone("1182");
    await connect(back, "1182");

    expect(back.kinds()).not.toContain("draft");
  });

  it("forgets every held draft when the last crane socket goes", async () => {
    const { box, crane, phone, say, connect } = room();
    await say(crane, { kind: "draft", user_id: "1182", text: "Looks like" });
    await say(crane, { kind: "draft", user_id: "7", text: "Two days" });

    crane.close();
    await box.webSocketClose(crane as unknown as WebSocket);

    const ada = phone("1182");
    await connect(ada, "1182");
    const bob = phone("7");
    await connect(bob, "7");
    expect(ada.sent).toEqual([]);
    expect(bob.sent).toEqual([]);
  });

  it("forgets on a crane socket error too", async () => {
    const { box, crane, phone, say, connect } = room();
    await say(crane, { kind: "draft", user_id: "1182", text: "Looks like" });

    await box.webSocketError(crane as unknown as WebSocket);

    const ada = phone("1182");
    await connect(ada, "1182");
    expect(ada.sent).toEqual([]);
  });

  it("keeps the draft when a fresh-dial crane socket closes while the main one is up", async () => {
    const { state, box, crane, phone, say, connect } = room();
    await say(crane, { kind: "draft", user_id: "1182", text: "Looks like" });

    const dial = new FakeSocket();
    state.acceptWebSocket(dial, socketTags({ role: "crane", rateId: "bearer:kit" }));
    dial.close();
    await box.webSocketClose(dial as unknown as WebSocket);

    const ada = phone("1182");
    await connect(ada, "1182");
    expect(ada.frames()).toEqual([{ kind: "draft", user_id: "1182", text: "Looks like" }]);
  });

  it("does not forget when a phone socket goes", async () => {
    const { box, crane, phone, say, connect } = room();
    const first = phone("1182");
    await say(crane, { kind: "draft", user_id: "1182", text: "Looks like" });

    first.close();
    await box.webSocketClose(first as unknown as WebSocket);

    const back = phone("1182");
    await connect(back, "1182");
    expect(back.frames()).toEqual([{ kind: "draft", user_id: "1182", text: "Looks like" }]);
  });

  it("expires a held draft after 60 s with no words and no typing; typing is life", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const { crane, phone, say, connect } = room();
      await say(crane, { kind: "draft", user_id: "1182", text: "Looks like" });

      vi.setSystemTime(1_000_000 + 50_000);
      await say(crane, { kind: "typing", user_id: "1182" });

      vi.setSystemTime(1_000_000 + 100_000); // 100 s after the words, 50 s after the chip
      const alive = phone("1182");
      await connect(alive, "1182");
      expect(alive.frames()).toEqual([{ kind: "draft", user_id: "1182", text: "Looks like" }]);

      vi.setSystemTime(1_000_000 + 50_000 + HELD_DRAFT_TTL_MS + 1);
      const ghost = phone("1182");
      await connect(ghost, "1182");
      expect(ghost.sent).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Agent round-trip push test", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The push service's answer. A spy, not a stub — the file-level socket stub must survive. */
  function pushServiceSays(status: number, onUrl?: (url: string) => void) {
    return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      onUrl?.(url);
      return Promise.resolve(new Response(null, { status }));
    });
  }

  async function vapidEnv(): Promise<Record<string, string>> {
    const keys = await generateVapidKeys();
    return {
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: JSON.stringify(keys.privateJwk),
      VAPID_SUBJECT: "mailto:ada@example.com",
    };
  }

  async function clientSub(endpoint: string) {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    return { endpoint, keys: { p256dh: encodeBase64Url(raw), auth: encodeBase64Url(auth) } };
  }

  function pushOp(method: string, sub: string, body: object): Request {
    return new Request("https://agent/push", {
      method,
      headers: { "X-Chat-Op": "push", "X-Chat-Sub": sub, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("pushes a real test card to this human's rows and reports the push service's answer", async () => {
    const { state, box } = room(await vapidEnv());
    const subscription = await clientSub("https://fcm.googleapis.com/fcm/send/ada-phone");
    expect((await box.fetch(pushOp("PUT", "1182", { slug: "kit", subscription }))).ok).toBe(true);
    const bob = await clientSub("https://fcm.googleapis.com/fcm/send/bob-phone");
    expect((await box.fetch(pushOp("PUT", "7", { slug: "kit", subscription: bob }))).ok).toBe(true);

    const pushService = pushServiceSays(201, (url) => expect(url).toBe(subscription.endpoint));
    const ok = await box.fetch(pushOp("POST", "1182", { slug: "kit" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ rows: 1, ok: 1, gone: 0, fail: 0, statuses: [] });
    expect(pushService).toHaveBeenCalledOnce();

    pushServiceSays(403);
    const refused = await box.fetch(pushOp("POST", "1182", { slug: "kit" }));
    expect(await refused.json()).toEqual({ rows: 1, ok: 0, gone: 0, fail: 1, statuses: [403] });

    pushServiceSays(410);
    const gone = await box.fetch(pushOp("POST", "1182", { slug: "kit" }));
    expect(await gone.json()).toEqual({ rows: 1, ok: 0, gone: 1, fail: 0, statuses: [] });
    const left = [...state.storage.rows.keys()].filter((k) => k.startsWith(PUSH_STORE_PREFIX));
    expect(left).toHaveLength(1);
    expect(left[0]).toContain(":7:");

    const empty = await box.fetch(pushOp("POST", "1182", { slug: "kit" }));
    expect(await empty.json()).toEqual({ rows: 0, ok: 0, gone: 0, fail: 0, statuses: [] });
  });

  it("is 404 without VAPID keys and 400 on a junk body", async () => {
    const bare = room();
    expect((await bare.box.fetch(pushOp("POST", "1182", { slug: "kit" }))).status).toBe(404);
    const keyed = room(await vapidEnv());
    expect((await keyed.box.fetch(pushOp("POST", "1182", { slug: "nope!" }))).status).toBe(400);
  });
});

describe("Agent aims board", () => {
  const board = [{ area: "training", sentence: "gym 3 mornings/wk", rating30: 1.4, sum7: 6, streak: 2, note: "asked", days: [] }];

  it("stores the crane's board, fans it to phones, and replays it on connect after cmds", async () => {
    const { state, crane, phone, say, connect } = room();
    const ada = phone("1182");
    await say(crane, { kind: "cmds", commands: [{ name: "aims", hint: "goals and progress", args: true }] });
    const links = [{ a: "training", b: "weight", r: 0.38, n: 12 }];
    await say(crane, { kind: "aims", aims: [...board, { area: "junk" }], links: [...links, { a: "x" }] });

    expect(ada.frames().at(-1)).toEqual({ kind: "aims", aims: board, links });
    expect(state.storage.rows.get("aims")).toBe(JSON.stringify({ kind: "aims", aims: board, links }));

    const fresh = phone("1182");
    await connect(fresh, "1182");
    expect(fresh.kinds().slice(0, 2)).toEqual(["cmds", "aims"]);
  });

  it("an empty board is a real frame — stored and sent so a screen clears", async () => {
    const { state, crane, phone, say, connect } = room();
    const ada = phone("1182");
    await say(crane, { kind: "aims", aims: board });
    await say(crane, { kind: "aims", aims: [] });

    expect(ada.frames().at(-1)).toEqual({ kind: "aims", aims: [] });
    expect(state.storage.rows.get("aims")).toBe(JSON.stringify({ kind: "aims", aims: [] }));
    const fresh = phone("1182");
    await connect(fresh, "1182");
    expect(fresh.frames().find((f) => f.kind === "aims")).toEqual({ kind: "aims", aims: [] });
  });

  it("a board naming a human goes only to that human and wins over the room board on connect", async () => {
    const { crane, phone, say, connect } = room();
    const ada = phone("1182");
    const bob = phone("7");
    await say(crane, { kind: "aims", aims: [] });
    ada.sent.length = 0;
    bob.sent.length = 0;
    await say(crane, { kind: "aims", user_id: "1182", aims: board });

    expect(ada.frames()).toEqual([{ kind: "aims", aims: board, user_id: "1182" }]);
    expect(bob.sent).toEqual([]);

    const adaAgain = phone("1182");
    await connect(adaAgain, "1182");
    expect(adaAgain.frames().filter((f) => f.kind === "aims")).toEqual([{ kind: "aims", aims: board, user_id: "1182" }]);
    const bobAgain = phone("7");
    await connect(bobAgain, "7");
    expect(bobAgain.frames().filter((f) => f.kind === "aims")).toEqual([{ kind: "aims", aims: [] }]);
  });

  it("refuses a board from a phone", async () => {
    const { crane, phone, say } = room();
    const ada = phone("1182");
    await say(ada, { kind: "aims", aims: board });
    expect(ada.frames()).toEqual([{ kind: "error", text: "bad frame" }]);
    expect(crane.sent).toEqual([]);
  });
});

describe("Agent tasks board", () => {
  const list = [
    { id: 412, slug: "dentist", text: "call to book a cleaning", at: "2026-09-23" },
    { id: 418, slug: "passport", text: "renew, by Oct 15", at: "2026-09-26" },
  ];

  it("stores the crane's list, fans it to phones, and replays it on connect after aims", async () => {
    const { state, crane, phone, say, connect } = room();
    const ada = phone("1182");
    await say(crane, { kind: "cmds", commands: [{ name: "todo", hint: "pocket list", args: true }] });
    await say(crane, { kind: "aims", aims: [] });
    await say(crane, { kind: "todo", todo: [...list, { id: "x", slug: "junk" }] });

    expect(ada.frames().at(-1)).toEqual({ kind: "todo", todo: list });
    expect(state.storage.rows.get("todo")).toBe(JSON.stringify({ kind: "todo", todo: list }));

    const fresh = phone("1182");
    await connect(fresh, "1182");
    expect(fresh.kinds().slice(0, 3)).toEqual(["cmds", "aims", "todo"]);
  });

  it("an empty list is a real frame — stored and sent so the drawer clears", async () => {
    const { state, crane, phone, say, connect } = room();
    const ada = phone("1182");
    await say(crane, { kind: "todo", todo: list });
    await say(crane, { kind: "todo", todo: [] });

    expect(ada.frames().at(-1)).toEqual({ kind: "todo", todo: [] });
    expect(state.storage.rows.get("todo")).toBe(JSON.stringify({ kind: "todo", todo: [] }));
    const fresh = phone("1182");
    await connect(fresh, "1182");
    expect(fresh.frames().find((f) => f.kind === "todo")).toEqual({ kind: "todo", todo: [] });
  });

  it("a list naming a human goes only to that human and wins over the room list on connect", async () => {
    const { crane, phone, say, connect } = room();
    const ada = phone("1182");
    const bob = phone("7");
    await say(crane, { kind: "todo", todo: [] });
    ada.sent.length = 0;
    bob.sent.length = 0;
    await say(crane, { kind: "todo", user_id: "1182", todo: list });

    expect(ada.frames()).toEqual([{ kind: "todo", todo: list, user_id: "1182" }]);
    expect(bob.sent).toEqual([]);

    const adaAgain = phone("1182");
    await connect(adaAgain, "1182");
    expect(adaAgain.frames().filter((f) => f.kind === "todo")).toEqual([{ kind: "todo", todo: list, user_id: "1182" }]);
    const bobAgain = phone("7");
    await connect(bobAgain, "7");
    expect(bobAgain.frames().filter((f) => f.kind === "todo")).toEqual([{ kind: "todo", todo: [] }]);
  });

  it("refuses a list from a phone; the checkbox is an ordinary /todo done turn", async () => {
    const { crane, phone, say } = room();
    const ada = phone("1182");
    await say(ada, { kind: "todo", todo: list });
    expect(ada.frames()).toEqual([{ kind: "error", text: "bad frame" }]);
    expect(crane.sent).toEqual([]);

    await say(ada, { id: "m1", text: "/todo done 412" });
    expect(crane.frames().at(-1)).toMatchObject({ kind: "inbound", text: "/todo done 412", user_id: "1182" });
  });
});

describe("Agent reactions", () => {
  it("fans Kit's reaction to the human's mouths, stores it, and hydrates it after the bubble", async () => {
    const { state, crane, phone, say, connect } = room();
    const pwa = phone("1182");
    const cab = phone("1182");
    const bob = phone("7");
    await say(pwa, { id: "m1", text: "thanks!" });

    await say(crane, { kind: "react", user_id: "1182", id: "m1", text: "👍" });

    expect(cab.frames().filter((f) => f.kind === "react")).toEqual([
      { kind: "react", id: "m1", text: "👍", user_id: "1182" },
    ]);
    expect(pwa.frames().filter((f) => f.kind === "react")).toEqual([
      { kind: "react", id: "m1", text: "👍", user_id: "1182" },
    ]);
    expect(bob.sent).toEqual([]);
    expect(state.storage.queued().some((q) => q.kind === "react")).toBe(false);
    expect(state.storage.rows.get("r:1182")).toEqual({ m1: "👍" });

    const fresh = phone("1182");
    await connect(fresh, "1182");
    const kinds = fresh.kinds();
    expect(kinds.indexOf("react")).toBeGreaterThan(kinds.indexOf("inbound"));
    expect(fresh.frames().find((f) => f.kind === "react")).toEqual({
      kind: "react", id: "m1", text: "👍", user_id: "1182", replay: true,
    });
  });

  it("hands the human's reaction to the crane and their other mouths, not back to the sender", async () => {
    const { state, crane, phone, say } = room();
    const pwa = phone("1182");
    const cab = phone("1182");
    await say(crane, { kind: "reply", id: "r1", user_id: "1182", text: "Rain at 6." });
    crane.sent.length = 0;
    pwa.sent.length = 0;
    cab.sent.length = 0;

    await say(pwa, { kind: "react", id: "r1", text: "❤️" });

    expect(crane.frames()).toEqual([{ kind: "react", id: "r1", text: "❤️", user_id: "1182" }]);
    expect(cab.frames()).toEqual([{ kind: "react", id: "r1", text: "❤️", user_id: "1182" }]);
    expect(pwa.sent).toEqual([]);
    expect(state.storage.rows.get("r:1182")).toEqual({ r1: "❤️" });

    await say(pwa, { kind: "react", id: "r1", text: "" });
    expect(crane.frames().at(-1)).toEqual({ kind: "react", id: "r1", text: "", user_id: "1182" });
    expect(cab.frames().at(-1)).toEqual({ kind: "react", id: "r1", text: "", user_id: "1182" });
    expect(state.storage.rows.has("r:1182")).toBe(false);
  });

  it("queues the human's reaction when no crane socket is up; latest on a bubble wins; the crane drains it on connect", async () => {
    const { state, box, crane, phone, say } = room();
    const pwa = phone("1182");
    await say(crane, { kind: "reply", id: "r1", user_id: "1182", text: "Rain at 6." });
    await say(crane, { kind: "reply", id: "r2", user_id: "1182", text: "Bring a coat." });
    crane.close();
    pwa.sent.length = 0;

    await say(pwa, { kind: "react", id: "r1", text: "👍" });
    await say(pwa, { kind: "react", id: "r1", text: "❤️" });
    await say(pwa, { kind: "react", id: "r2", text: "🔥" });

    const forCrane = state.storage.queued().filter((q) => q.to === "crane");
    expect(forCrane.map((q) => [q.id, q.kind])).toEqual([["r1", "react"], ["r2", "react"]]);
    expect(pwa.sent).toEqual([]); // no ack for a react, no error either
    expect(state.storage.rows.get("r:1182")).toEqual({ r1: "❤️", r2: "🔥" });

    const back = new FakeSocket();
    state.acceptWebSocket(back, socketTags({ role: "crane", rateId: "bearer:kit" }));
    await (box as unknown as Flushable).flush(back, "crane");
    const reacts = back.frames().filter((f) => f.kind === "react");
    expect(reacts.map((f) => [f.id, f.text, f.user_id])).toEqual([["r1", "❤️", "1182"], ["r2", "🔥", "1182"]]);
    expect(state.storage.queued().filter((q) => q.to === "crane")).toEqual([]);
  });

  it("refuses a react without an id or with junk text, and a crane react without a human", async () => {
    const { crane, phone, say } = room();
    const pwa = phone("1182");

    await say(pwa, { kind: "react", text: "👍" });
    await say(pwa, { kind: "react", id: "r1", text: "x\u0000" });
    await say(crane, { kind: "react", id: "m1", text: "👍" });

    expect(pwa.frames()).toEqual([
      { kind: "error", text: "bad frame" },
      { kind: "error", text: "bad frame", id: "r1" },
    ]);
    expect(crane.frames()).toEqual([{ kind: "error", text: "bad frame", id: "m1" }]);
  });

  it("does not spend the crane's turn bucket on a react", async () => {
    const { crane, phone, say } = room();
    const pwa = phone("1182");
    await say(pwa, { id: "m1", text: "hi" });
    pwa.sent.length = 0;
    for (let i = 0; i < 40; i += 1) {
      await say(crane, { kind: "react", user_id: "1182", id: "m1", text: i % 2 ? "👍" : "❤️" });
    }
    expect(pwa.frames().every((f) => f.kind === "react")).toBe(true);
    expect(pwa.frames()).toHaveLength(40);
  });
});

describe("Agent room ops", () => {
  it("stores the harness bearer and the allow list", async () => {
    const directory = {
      rows: new Map<string, string>(),
      get: (key: string) => Promise.resolve(directory.rows.get(key) ?? null),
      put: (key: string, value: string) => {
        directory.rows.set(key, value);
        return Promise.resolve();
      },
      delete: (key: string) => {
        directory.rows.delete(key);
        return Promise.resolve();
      },
    };
    const { state, box, crane, phone, say } = room({
      GOOGLE_CLIENT_ID: "id",
      DIRECTORY: directory,
    });
    const ada = "118212345678901234567";
    await state.storage.put("slug", "kit");
    const kept = phone(ada);
    const dropped = phone("9999999999");

    const bad = await box.fetch(new Request("https://agent/bearer", {
      method: "PUT",
      headers: { "X-Chat-Op": "bearer", "content-type": "application/json" },
      body: "{",
    }));
    expect(bad.status).toBe(400);
    const empty = await box.fetch(new Request("https://agent/bearer", {
      method: "POST",
      headers: { "X-Chat-Op": "bearer", "content-type": "application/json" },
      body: JSON.stringify({ bearer: "  " }),
    }));
    expect(empty.status).toBe(400);
    const put = await box.fetch(new Request("https://agent/bearer", {
      method: "PUT",
      headers: { "X-Chat-Op": "bearer", "content-type": "application/json" },
      body: JSON.stringify({ bearer: "from-do" }),
    }));
    expect(put.ok).toBe(true);
    const got = await box.fetch(new Request("https://agent/bearer", {
      headers: { "X-Chat-Op": "bearer" },
    }));
    expect(await got.json()).toEqual({ bearer: "from-do" });
    const method = await box.fetch(new Request("https://agent/bearer", {
      method: "DELETE",
      headers: { "X-Chat-Op": "bearer" },
    }));
    expect(method.status).toBe(405);

    await say(crane, { kind: "allow", users: [{ sub: ada, email: "Ada@Example.com" }] });
    expect(kept.readyState).toBe(OPEN);
    expect(dropped.readyState).toBe(CLOSING);
    const listed = await box.fetch(new Request("https://agent/allow", {
      headers: { "X-Chat-Op": "allow" },
    }));
    expect(await listed.json()).toEqual({ users: [{ sub: ada, email: "ada@example.com" }] });
    expect(directory.rows.get(`sub:${ada}`)).toContain("kit");
    expect(state.storage.rows.get("allow.hash")).toBeTruthy();
  });

  it("serves a face and clears a backdrop", async () => {
    const { box, phone } = room();
    const live = phone("1182");
    const jpeg = new Uint8Array(32);
    jpeg[0] = 0xff;
    jpeg[1] = 0xd8;
    jpeg[2] = 0xff;
    const saved = await box.fetch(new Request("https://agent/avatar", {
      method: "PUT",
      headers: { "X-Chat-Op": "avatar" },
      body: jpeg,
    }));
    expect(saved.ok).toBe(true);
    const face = live.frames().at(-1);
    expect(face?.kind).toBe("face");
    const read = await box.fetch(new Request("https://agent/avatar", {
      headers: { "X-Chat-Op": "avatar" },
    }));
    expect(read.headers.get("content-type")).toBe("image/jpeg");
    expect(read.headers.get("X-Chat-Rev")).toBeTruthy();
    const again = await box.fetch(new Request("https://agent/avatar", {
      headers: { "X-Chat-Op": "avatar", "If-None-Match": read.headers.get("ETag") ?? "" },
    }));
    expect(again.status).toBe(304);
    const junk = await box.fetch(new Request("https://agent/avatar", {
      method: "PUT",
      headers: { "X-Chat-Op": "avatar" },
      body: new Uint8Array(32),
    }));
    expect(junk.status).toBe(400);
    const missing = await box.fetch(new Request("https://agent/backdrop", {
      headers: { "X-Chat-Op": "backdrop" },
    }));
    expect(missing.status).toBe(404);
    const wall = await box.fetch(new Request("https://agent/backdrop", {
      method: "PUT",
      headers: { "X-Chat-Op": "backdrop" },
      body: jpeg,
    }));
    expect(wall.ok).toBe(true);
    const cleared = await box.fetch(new Request("https://agent/backdrop", {
      method: "DELETE",
      headers: { "X-Chat-Op": "backdrop" },
    }));
    expect(await cleared.json()).toMatchObject({ ok: true, rev: 0 });
    const noFaceDelete = await box.fetch(new Request("https://agent/avatar", {
      method: "DELETE",
      headers: { "X-Chat-Op": "avatar" },
    }));
    expect(noFaceDelete.status).toBe(405);
  });
});

describe("Agent harness ops", () => {
  class Pair {
    0 = new FakeSocket();
    1 = new FakeSocket();
  }

  /** Node's Response rejects status 101. Cloudflare accepts it, with `webSocket`. */
  class SwitchableResponse extends Response {
    constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
      const status = init?.status;
      const rest: ResponseInit = { ...init };
      delete (rest as { webSocket?: unknown }).webSocket;
      super(body, status === 101 ? { ...rest, status: 200 } : rest);
      if (status === 101) {
        Object.defineProperty(this, "status", { value: 101 });
      }
    }
  }

  const realResponse = globalThis.Response;

  function installPairs(): void {
    vi.stubGlobal("WebSocketPair", Pair);
    vi.stubGlobal("Response", SwitchableResponse);
  }

  afterEach(() => {
    vi.stubGlobal("Response", realResponse);
  });

  it("sends config before queued chat and keeps harness frames off phones", async () => {
    installPairs();
    const seen: { agent: string; kind: string; value: number }[] = [];
    const store = new Map<string, Uint8Array>();
    const { state, box, crane, phone, say } = room({
      SETTINGS: {
        getByName: () => ({
          addSample: (input: { agent: string; kind: string; value: number }) => {
            seen.push(input);
            return Promise.resolve({ ok: true });
          },
        }),
      },
      STORE: {
        get: (key: string) => {
          const hit = store.get(key);
          if (!hit) {
            return Promise.resolve(null);
          }
          const copy = hit.slice();
          return Promise.resolve({
            arrayBuffer: () => Promise.resolve(copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength)),
          });
        },
        put: (key: string, value: ArrayBuffer) => {
          store.set(key, new Uint8Array(value));
          return Promise.resolve();
        },
      },
    });
    await state.storage.put("bearer", "room-secret");
    await state.storage.put("slug", "kit");
    await state.storage.put(CONFIG_STORE_KEY, { env: { LLM_API_KEY: "sekrit" }, mcp: "toml", persona: "be brief", updatedAt: 5 });
    store.set("backups/kit/latest/gantry_db", new Uint8Array([1, 2, 3]));
    crane.close();
    const ada = phone("1182");
    await say(ada, { id: "m1", text: "ping" });

    const res = await box.fetch(new Request("https://gantree.test/ws/kit?role=crane", {
      headers: {
        Upgrade: "websocket",
        "X-Chat-Role": "crane",
        "X-Chat-Slug": "kit",
        "X-Chat-Rate": "bearer:kit",
      },
    }));
    expect(res.status).toBe(101);
    const fresh = state.getWebSockets("role:crane").find((socket) => socket.sent.some((line) => line.includes("\"kind\":\"config\"")));
    if (!fresh) {
      throw new Error("missing crane");
    }
    const first = JSON.parse(fresh.sent[0] ?? "{}") as { kind?: string; env?: { LLM_API_KEY?: string }; restore?: { gantry_db?: string } };
    expect(first.kind).toBe("config");
    expect(first.env?.LLM_API_KEY).toBe("sekrit");
    expect(fresh.sent[1]).toContain("ping");
    expect(ada.sent.join("")).not.toContain("sekrit");
    expect(ada.sent.join("")).not.toContain("\"kind\":\"config\"");
    const restore = new URL(first.restore?.gantry_db ?? "https://invalid");
    const exp = Number(restore.searchParams.get("exp"));
    expect(exp).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
    expect(await verifySnapshot("room-secret", "kit", "gantry_db", "GET", restore.searchParams.get("exp") ?? "", restore.searchParams.get("sig") ?? "", Date.now())).toBe(true);

    const before = ada.sent.length;
    await box.webSocketMessage(fresh as unknown as WebSocket, JSON.stringify({
      kind: "status",
      published: ["maps"],
      skipped: [{ name: "strava", reason: "no_key" }],
    }));
    await box.webSocketMessage(fresh as unknown as WebSocket, JSON.stringify({
      kind: "perf",
      turn: "t1",
      outcome: "error",
      tokens: { prompt: 11, completion: 4 },
    }));
    await box.webSocketMessage(fresh as unknown as WebSocket, JSON.stringify({
      kind: "log",
      level: "INFO",
      message: "booted",
      at: "2026-10-10T00:00:00Z",
      dropped: 2,
    }));
    await box.webSocketMessage(fresh as unknown as WebSocket, JSON.stringify({
      kind: "snapshot",
      stamp: "20261010T120000Z",
      bytes: 3,
    }));
    expect(ada.sent.length).toBe(before);
    expect(seen.map((row) => row.kind)).toEqual(["tokens_prompt", "tokens_completion", "turn"]);

    const status = await box.fetch(new Request("https://agent/status", { headers: { "X-Chat-Op": "status" } }));
    expect(await status.json()).toMatchObject({
      harness: "connected",
      published: ["maps"],
      skipped: [{ name: "strava", reason: "no_key" }],
      perf: { turns: 1, prompt: 11, completion: 4, errors: 1 },
      lastSnapshot: { stamp: "20261010T120000Z", bytes: 3 },
    });
    const log = await box.fetch(new Request("https://agent/log?after=0", { headers: { "X-Chat-Op": "log" } }));
    expect(await log.json()).toMatchObject({ lines: [{ level: "info", message: "booted", dropped: 2 }], next: 1 });

    for (let i = 0; i < 5; i++) {
      if (store.has("backups/kit/20261010T120000Z/gantry_db")) {
        break;
      }
      await Promise.resolve();
    }
    expect(store.has("backups/kit/20261010T120000Z/gantry_db")).toBe(true);

    const view = await box.fetch(new Request("https://agent/config", { headers: { "X-Chat-Op": "config" } }));
    const viewBody = await view.json<{ envKeys: string[]; recreate: boolean }>();
    expect(viewBody.envKeys).toEqual(["LLM_API_KEY"]);
    expect(JSON.stringify(viewBody)).not.toContain("sekrit");
    expect(viewBody.recreate).toBe(false);

    const patched = await box.fetch(new Request("https://agent/config", {
      method: "PATCH",
      headers: { "X-Chat-Op": "config", "content-type": "application/json" },
      body: JSON.stringify({ env: { LLM_API_KEY: null, OTHER: "x" } }),
    }));
    expect(await patched.json()).toMatchObject({ envKeys: ["OTHER"], recreate: false });

    const started = await box.fetch(new Request("https://agent/config", {
      method: "POST",
      headers: { "X-Chat-Op": "config", "content-type": "application/json" },
      body: JSON.stringify({ started: true }),
    }));
    expect((await started.json<{ recreate: boolean }>()).recreate).toBe(false);
    const drifted = await box.fetch(new Request("https://agent/config", {
      method: "PATCH",
      headers: { "X-Chat-Op": "config", "content-type": "application/json" },
      body: JSON.stringify({ env: { OTHER: "y" } }),
    }));
    expect((await drifted.json<{ recreate: boolean }>()).recreate).toBe(true);
  });

  it("lays the house LLM keys under the agent env on the config frame and names them on the view", async () => {
    installPairs();
    const { state, box, crane } = room({ LLM_MODEL: "house-model", LLM_API_KEY: "house-key", LLM_BASE_URL: " " });
    await state.storage.put("slug", "kit");
    await state.storage.put(CONFIG_STORE_KEY, { env: { LLM_MODEL: "mine" }, mcp: "", persona: "be brief", updatedAt: 5 });
    crane.close();
    const res = await box.fetch(new Request("https://gantree.test/ws/kit?role=crane", {
      headers: { Upgrade: "websocket", "X-Chat-Role": "crane", "X-Chat-Slug": "kit", "X-Chat-Rate": "bearer:kit" },
    }));
    expect(res.status).toBe(101);
    const fresh = state.getWebSockets("role:crane").find((socket) => socket.sent.some((line) => line.includes("\"kind\":\"config\"")));
    const first = JSON.parse(fresh?.sent[0] ?? "{}") as { env?: Record<string, string> };
    expect(first.env).toEqual({ LLM_MODEL: "mine", LLM_API_KEY: "house-key" });

    const view = await box.fetch(new Request("https://agent/config", { headers: { "X-Chat-Op": "config" } }));
    const body = await view.text();
    expect(JSON.parse(body)).toMatchObject({ envKeys: ["LLM_MODEL"], house: ["LLM_API_KEY", "LLM_MODEL"] });
    expect(body).not.toContain("house-key");
  });

  it("does not reset perf when a second crane socket opens, and marks the room down when the last one closes", async () => {
    installPairs();
    const { state, box, crane } = room();
    crane.close();
    await box.webSocketClose(crane as unknown as WebSocket);
    await state.storage.put("slug", "kit");
    const open = () => box.fetch(new Request("https://gantree.test/ws/kit", {
      headers: { Upgrade: "websocket", "X-Chat-Role": "crane", "X-Chat-Slug": "kit" },
    }));
    expect((await open()).status).toBe(101);
    const first = state.getWebSockets("role:crane").find((socket) => socket.readyState === OPEN);
    if (!first) {
      throw new Error("missing crane");
    }
    await box.webSocketMessage(first as unknown as WebSocket, JSON.stringify({ kind: "perf", tokens: { prompt: 1, completion: 1 }, outcome: "ok" }));
    expect((await open()).status).toBe(101);
    const mid = await box.fetch(new Request("https://agent/status", { headers: { "X-Chat-Op": "status" } }));
    expect((await mid.json<{ perf: { turns: number } }>()).perf.turns).toBe(1);
    first.close();
    await box.webSocketClose(first as unknown as WebSocket);
    const still = await box.fetch(new Request("https://agent/status", { headers: { "X-Chat-Op": "status" } }));
    expect((await still.json<{ harness: string }>()).harness).toBe("connected");
    for (const socket of state.getWebSockets("role:crane")) {
      if (socket.readyState === OPEN) {
        socket.close();
        await box.webSocketClose(socket as unknown as WebSocket);
      }
    }
    const down = await box.fetch(new Request("https://agent/status", { headers: { "X-Chat-Op": "status" } }));
    expect((await down.json<{ harness: string }>()).harness).toBe("disconnected");
  });

  it("refuses a phone status frame and answers config and log errors", async () => {
    const { box, crane, phone, say } = room();
    const ada = phone("1182");
    await say(ada, { kind: "status", published: ["maps"] });
    expect(ada.frames()).toEqual([{ kind: "error", text: "bad frame" }]);
    expect(crane.sent).toEqual([]);

    const bad = await box.fetch(new Request("https://agent/config", {
      method: "PATCH",
      headers: { "X-Chat-Op": "config" },
      body: "{",
    }));
    expect(bad.status).toBe(400);
    const method = await box.fetch(new Request("https://agent/status", {
      method: "POST",
      headers: { "X-Chat-Op": "status" },
    }));
    expect(method.status).toBe(405);
    const cursor = await box.fetch(new Request("https://agent/log?after=nope", { headers: { "X-Chat-Op": "log" } }));
    expect(cursor.status).toBe(400);
    const put = await box.fetch(new Request("https://agent/allow", {
      method: "PUT",
      headers: { "X-Chat-Op": "allow", "content-type": "application/json" },
      body: JSON.stringify({ users: [{ sub: "118212345678901234567", email: "Ada@Example.com" }, "nope"] }),
    }));
    expect(await put.json()).toEqual({ users: [{ sub: "118212345678901234567", email: "ada@example.com" }] });
    const missing = await box.fetch(new Request("https://agent/allow", {
      method: "PUT",
      headers: { "X-Chat-Op": "allow" },
      body: "{}",
    }));
    expect(missing.status).toBe(400);
  });

  it("records samples through idFromName when getByName is absent", async () => {
    const seen: string[] = [];
    const { state, box, crane, say } = room({
      SETTINGS: {
        idFromName: () => ({ toString: () => "settings" }),
        get: () => ({
          addSample: (input: { kind: string }) => {
            seen.push(input.kind);
            return Promise.resolve({ ok: true });
          },
        }),
      },
    });
    await state.storage.put("slug", "kit");
    await say(crane, { kind: "perf", tokens: { prompt: 2, completion: 0 } });
    expect(seen).toEqual(["tokens_prompt", "tokens_completion", "turn"]);
    const bytes = new TextEncoder().encode(JSON.stringify({ kind: "log", level: "warn", message: "bin" }));
    await box.webSocketMessage(
      crane as unknown as WebSocket,
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const log = await box.fetch(new Request("https://agent/log", { headers: { "X-Chat-Op": "log" } }));
    expect((await log.json<{ lines: { message: string }[] }>()).lines[0]?.message).toBe("bin");
  });
});
