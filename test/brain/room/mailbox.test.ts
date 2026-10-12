import { describe, expect, it, vi } from "vitest";
import { chatLoopbackFetch, mailboxSocket, withChatMailbox } from "@/brain/room/mailbox";

describe("mailboxSocket", () => {
  it("maps https to wss and strips origin path", () => {
    expect(mailboxSocket("https://gantree2.bldhosting.com/extra", "kit")).toBe(
      "wss://gantree2.bldhosting.com/ws/kit",
    );
  });

  it("maps http to ws", () => {
    expect(mailboxSocket("http://127.0.0.1:3000", "kit")).toBe("ws://127.0.0.1:3000/ws/kit");
  });

  it("rejects bad slug", () => {
    expect(mailboxSocket("https://x.test", "1bad")).toBeNull();
  });
});

describe("withChatMailbox", () => {
  it("fills missing chat env without overwriting", () => {
    const filled = withChatMailbox({}, {
      origin: "https://gantree2.bldhosting.com",
      slug: "kit",
      bearer: "room-token",
    });
    expect(filled.CHAT_MAILBOX_URL).toBe("wss://gantree2.bldhosting.com/ws/kit");
    expect(filled.CHAT_BEARER).toBe("room-token");

    const kept = withChatMailbox(
      { CHAT_MAILBOX_URL: "wss://other.test/ws/ada", CHAT_BEARER: "custom" },
      { origin: "https://gantree2.bldhosting.com", slug: "kit", bearer: "room-token" },
    );
    expect(kept.CHAT_MAILBOX_URL).toBe("wss://other.test/ws/ada");
    expect(kept.CHAT_BEARER).toBe("custom");
  });
});

describe("chatLoopbackFetch", () => {
  const origin = "https://gantree2.bldhosting.com";
  const slug = "kit";
  const bearer = "room-bearer";

  it("serves matching avatar POST with room bearer", async () => {
    const serve = vi.fn(async () => Response.json({ ok: true }));
    const base = vi.fn(async () => Response.json({ routed: "base" }));
    const fetch = chatLoopbackFetch(base, { origin, slug, bearer, serve });
    const res = await fetch(`https://gantree2.bldhosting.com/api/chat/avatar?slug=kit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}` },
      body: "jpeg",
    });
    expect(serve).toHaveBeenCalledTimes(1);
    expect(base).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 401 for wrong bearer without calling serve", async () => {
    const serve = vi.fn(async () => Response.json({ ok: true }));
    const base = vi.fn(async () => Response.json({ routed: "base" }));
    const fetch = chatLoopbackFetch(base, { origin, slug, bearer, serve });
    const res = await fetch(`https://gantree2.bldhosting.com/api/chat/avatar?slug=kit`, {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
    });
    expect(serve).not.toHaveBeenCalled();
    expect(base).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
  });

  it("delegates to base for a different host", async () => {
    const serve = vi.fn(async () => Response.json({ ok: true }));
    const base = vi.fn(async () => Response.json({ routed: "base" }));
    const fetch = chatLoopbackFetch(base, { origin, slug, bearer, serve });
    const res = await fetch("https://other.test/api/chat/avatar?slug=kit", {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(serve).not.toHaveBeenCalled();
    expect(base).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ routed: "base" });
  });
});
