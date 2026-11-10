import { describe, expect, it, vi } from "vitest";
import type { RoomEnv } from "@/lib/avatar/http";
import { memoryStore } from "@/lib/door/users";
import { sealSession, SESSION_COOKIE, sessionKey } from "@/lib/door/session";
import { SPEAK_BYTES_MAX } from "@/lib/phone/speakable";
import { handleTts, type TtsEnv } from "@/lib/tts/http";
import { settingsInventory } from "../chat/settingsStub";

const SECRET = "0123456789abcdef0123456789abcdef-more";
const SUB = "118212345678901234567";

const env = {
  SESSION_SECRET: SECRET,
  GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
  GANTREE_ADMINS: "ada@example.com",
  GOOGLE_TTS_API_KEY: "key",
} as RoomEnv & TtsEnv;

async function cookie(): Promise<string> {
  const token = await sealSession(await sessionKey(SECRET), { sub: SUB, email: "ada@example.com" });
  return `${SESSION_COOKIE}=${token}`;
}

/** Room list the Agent DO would return for `X-Chat-Op: allow`. */
function room(users: { sub: string; email: string }[]): RoomEnv & TtsEnv {
  return {
    ...env,
    SETTINGS: settingsInventory(["kit"]),
    AGENT: {
      idFromName: () => "id",
      get: () => ({
        fetch: () => Promise.resolve(Response.json({ users })),
      }),
    },
  } as unknown as RoomEnv & TtsEnv;
}

function speak(slug: string | null, body: string, headers: Record<string, string> = {}): Request {
  const q = slug === null ? "" : `?slug=${encodeURIComponent(slug)}`;
  return new Request(`https://chat.test/api/chat/tts${q}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

const listed = [{ sub: SUB, email: "ada@example.com" }];

describe("handleTts", () => {
  it("answers the voice probe without a session when the key is set", async () => {
    const res = await handleTts(new Request("https://chat.test/api/chat/tts"), env, memoryStore());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voice: true });
  });

  it("is 404 when voice is off", async () => {
    const res = await handleTts(new Request("https://chat.test/api/chat/tts"), { ...env, VOICE: "off" }, memoryStore());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });

  it("POST is 404 and empty when voice is off, before slug or the key is spent", async () => {
    const fetchFn = vi.fn();
    const res = await handleTts(
      speak(null, JSON.stringify({ text: "hello" })),
      { ...env, VOICE: "off" },
      memoryStore(),
      fetchFn,
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("POST is 404 and empty when the key is unset", async () => {
    const fetchFn = vi.fn();
    const res = await handleTts(
      speak("kit", JSON.stringify({ text: "hello" })),
      { ...env, GOOGLE_TTS_API_KEY: "" },
      memoryStore(),
      fetchFn,
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed slug", async () => {
    const headers = { cookie: await cookie() };
    const fetchFn = vi.fn();
    const missing = await handleTts(speak(null, JSON.stringify({ text: "hello" }), headers), env, memoryStore(), fetchFn);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "bad slug" });
    const bad = await handleTts(speak("1bad", JSON.stringify({ text: "hello" }), headers), env, memoryStore(), fetchFn);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "bad slug" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("speaks for a person in the room", async () => {
    const fetchFn = vi.fn(async () => Response.json({ audioContent: btoa("mp3") }));
    const res = await handleTts(speak("kit", JSON.stringify({ text: "hello" }), {
      cookie: await cookie(),
    }), room(listed), memoryStore(), fetchFn);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("refuses a signed-in person who is not in the room", async () => {
    const fetchFn = vi.fn();
    const res = await handleTts(speak("kit", JSON.stringify({ text: "hello" }), {
      cookie: await cookie(),
    }), room([{ sub: "22222222222222222222", email: "nope@example.com" }]), memoryStore(), fetchFn);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects a speak with no session", async () => {
    const res = await handleTts(speak("kit", JSON.stringify({ text: "hello" })), room(listed), memoryStore(), vi.fn());
    expect(res.status).toBe(401);
  });

  it("still refuses a bad body for someone in the room", async () => {
    const headers = { cookie: await cookie() };
    const fetchFn = vi.fn();
    const res = await handleTts(speak("kit", "nope", headers), room(listed), memoryStore(), fetchFn);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad frame" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("still refuses an oversized speak for someone in the room", async () => {
    const headers = { cookie: await cookie() };
    const fetchFn = vi.fn();
    const res = await handleTts(
      speak("kit", JSON.stringify({ text: "a".repeat(SPEAK_BYTES_MAX + 1) }), headers),
      room(listed),
      memoryStore(),
      fetchFn,
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "too large" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
