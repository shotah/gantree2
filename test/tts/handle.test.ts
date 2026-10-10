import { describe, expect, it, vi } from "vitest";
import { memoryStore } from "@/lib/door/users";
import { sealSession, SESSION_COOKIE, sessionKey } from "@/lib/door/session";
import { handleTts, type TtsEnv } from "@/lib/tts/http";
import type { DoorEnv } from "@/lib/door/http";

const SECRET = "0123456789abcdef0123456789abcdef-more";

const env = {
  SESSION_SECRET: SECRET,
  GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
  GANTREE_ADMINS: "ada@example.com",
  GOOGLE_TTS_API_KEY: "key",
} as DoorEnv & TtsEnv;

async function cookie(): Promise<string> {
  const token = await sealSession(await sessionKey(SECRET), { sub: "118212345678901234567", email: "ada@example.com" });
  return `${SESSION_COOKIE}=${token}`;
}

describe("handleTts", () => {
  it("answers the voice probe without a session when the key is set", async () => {
    const res = await handleTts(new Request("https://chat.test/api/chat/tts"), env, memoryStore());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voice: true });
  });

  it("is 404 when voice is off", async () => {
    const res = await handleTts(new Request("https://chat.test/api/chat/tts"), { ...env, VOICE: "off" }, memoryStore());
    expect(res.status).toBe(404);
  });

  it("speaks for a signed-in person", async () => {
    const fetchFn = vi.fn(async () => Response.json({ audioContent: btoa("mp3") }));
    const res = await handleTts(new Request("https://chat.test/api/chat/tts", {
      method: "POST",
      headers: { cookie: await cookie(), "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    }), env, memoryStore(), fetchFn);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("rejects a speak with no session", async () => {
    const res = await handleTts(new Request("https://chat.test/api/chat/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    }), env, memoryStore(), vi.fn());
    expect(res.status).toBe(401);
  });
});
