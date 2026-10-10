import { describe, expect, it } from "vitest";
import { CONTEXT_JSON_MAX, FRAME_BYTES_MAX, TEXT_MAX } from "@/lib/chat/caps";
import { encodeError, encodeFrame, hasGeo, isBareGeo, parseFrame, peerOf, stampOrderOnBody, stampReplayOnBody, stripClientOrder, type ParseResult } from "@/lib/chat/frame";

function failMsg(r: ParseResult): string {
  return r.ok ? "ok" : r.error;
}

describe("frame", () => {
  it("parses text both ways", () => {
    const got = parseFrame(JSON.stringify({ text: "hi" }));
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.frame).toEqual({ text: "hi" });
      expect(got.bytes).toBeTypeOf("number");
      expect(encodeFrame(got.frame)).toBe('{"text":"hi"}');
    }
  });

  it("keeps geo on context and does not invent [location] text", () => {
    const raw = {
      text: "near me",
      context: {
        at: "2026-09-04T12:00:00.000Z",
        tz: "America/Los_Angeles",
        geo: { lat: 47.6, lon: -122.3, accuracy_m: 12, heading: 90, speed_mps: 1, alt_m: 10 },
        battery: { pct: 80, charging: false },
        net: "cellular",
        surface: "android_auto",
      },
    };
    const got = parseFrame(JSON.stringify(raw));
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.frame.text).toBe("near me");
      expect(got.frame.text).not.toContain("[location]");
      expect(got.frame.context?.geo).toEqual({
        lat: 47.6,
        lon: -122.3,
        accuracy_m: 12,
        heading: 90,
        speed_mps: 1,
        alt_m: 10,
      });
      expect(got.frame.context?.surface).toBe("android_auto");
      expect(hasGeo(got.frame)).toBe(true);
      expect(isBareGeo(got.frame)).toBe(false);
    }
  });

  it("treats geo-only as a silent pin", () => {
    const got = parseFrame(JSON.stringify({ context: { geo: { lat: 1, lon: 2 } } }));
    expect(got.ok && isBareGeo(got.frame)).toBe(true);
  });

  it("keeps FE surface names and drops the rest", () => {
    const browser = parseFrame(JSON.stringify({ context: { surface: "browser" } }));
    const android = parseFrame(JSON.stringify({ context: { surface: "android" } }));
    const auto = parseFrame(JSON.stringify({ context: { surface: "android_auto" } }));
    const ios = parseFrame(JSON.stringify({ context: { surface: "ios" } }));
    const carplay = parseFrame(JSON.stringify({ context: { surface: "carplay" } }));
    expect(browser.ok && browser.frame.context?.surface).toBe("browser");
    expect(android.ok && android.frame.context?.surface).toBe("android");
    expect(auto.ok && auto.frame.context?.surface).toBe("android_auto");
    expect(ios.ok && ios.frame.context?.surface).toBe("ios");
    expect(carplay.ok && carplay.frame.context?.surface).toBe("carplay");
    const oldPhone = parseFrame(JSON.stringify({ context: { surface: "phone" } }));
    const oldCar = parseFrame(JSON.stringify({ context: { surface: "car" } }));
    const desktop = parseFrame(JSON.stringify({ context: { surface: "desktop" } }));
    const dash = parseFrame(JSON.stringify({ context: { surface: "android-auto" } }));
    const pendant = parseFrame(JSON.stringify({ context: { surface: "pendant" } }));
    expect(oldPhone.ok && oldPhone.frame.context?.surface).toBeUndefined();
    expect(oldCar.ok && oldCar.frame.context?.surface).toBeUndefined();
    expect(desktop.ok && desktop.frame.context?.surface).toBeUndefined();
    expect(dash.ok && dash.frame.context?.surface).toBeUndefined();
    expect(pendant.ok && pendant.frame.context?.surface).toBeUndefined();
  });

  it("keeps context.input spoken as additive and drops other input names", () => {
    const spoken = parseFrame(JSON.stringify({ text: "hi", context: { surface: "browser", input: "spoken" } }));
    expect(spoken.ok && spoken.frame.context).toEqual({ surface: "browser", input: "spoken" });
    const typed = parseFrame(JSON.stringify({ context: { input: "typed" } }));
    expect(typed.ok && typed.frame.context?.input).toBeUndefined();
    const junk = parseFrame(JSON.stringify({ context: { input: 1 } }));
    expect(junk.ok && junk.frame.context?.input).toBeUndefined();
    const absent = parseFrame(JSON.stringify({ text: "hi", context: { geo: { lat: 1, lon: 2 } } }));
    expect(absent.ok && absent.frame.context?.input).toBeUndefined();
  });

  it("rejects junk, oversize text, and bad images", () => {
    expect(parseFrame("nope").ok).toBe(false);
    expect(parseFrame("[]").ok).toBe(false);
    expect(parseFrame(JSON.stringify({ text: 1 })).ok).toBe(false);
    expect(parseFrame(JSON.stringify({ kind: "nope" })).ok).toBe(false);
    expect(parseFrame(JSON.stringify({ user_id: 1 })).ok).toBe(false);
    expect(parseFrame(JSON.stringify({ images: { url: "x" } })).ok).toBe(false);
    expect(parseFrame(JSON.stringify({ images: [{ url: "ftp://x" }] })).ok).toBe(false);
    expect(parseFrame(JSON.stringify({ images: [{}] })).ok).toBe(false);
    expect(failMsg(parseFrame(JSON.stringify({ text: "x".repeat(TEXT_MAX + 1) })))).toBe("too large");
  });

  it("caps context and whole-frame bytes", () => {
    const fat = { context: { tz: "x".repeat(CONTEXT_JSON_MAX) } };
    expect(failMsg(parseFrame(JSON.stringify(fat)))).toBe("too large");
    const huge = "x".repeat(FRAME_BYTES_MAX + 1);
    expect(failMsg(parseFrame(huge))).toBe("too large");
  });

  it("accepts one https or data image and drops extra", () => {
    const ok = parseFrame(JSON.stringify({ images: [{ url: "https://example.test/a.jpg" }] }));
    expect(ok.ok).toBe(true);
    const two = parseFrame(JSON.stringify({
      images: [{ url: "https://a" }, { url: "https://b" }],
    }));
    expect(failMsg(two)).toBe("too large");
  });

  it("drops invalid geo and keeps a data-url photo", () => {
    const badGeo = parseFrame(JSON.stringify({ context: { geo: { lat: 100, lon: 0 } } }));
    expect(badGeo.ok && badGeo.frame.context?.geo).toBeUndefined();
    const img = parseFrame(JSON.stringify({ images: [{ url: "data:image/jpeg;base64,aa" }] }));
    expect(img.ok).toBe(true);
    expect(peerOf("phone")).toBe("crane");
    expect(peerOf("crane")).toBe("phone");
    const fromBuf = parseFrame(new TextEncoder().encode('{"text":"buf"}'));
    expect(fromBuf.ok && fromBuf.frame.text).toBe("buf");
  });

  it("accepts a crane cmds catalog", () => {
    const got = parseFrame(JSON.stringify({
      kind: "cmds",
      commands: [{ name: "NEW", hint: "reset this session", args: true }, { name: "nope" }],
    }));
    expect(got.ok && got.frame.kind).toBe("cmds");
    expect(got.ok && got.frame.commands).toEqual([{ name: "new", hint: "reset this session", args: true }]);
  });

  it("accepts a crane allow list and lowercases email", () => {
    const got = parseFrame(JSON.stringify({
      kind: "allow",
      users: [{ sub: "118212345678901234567", email: "Ada@Example.com" }, { email: "bob@example.com" }],
    }));
    expect(got.ok && got.frame.kind).toBe("allow");
    expect(got.ok && got.frame.users).toEqual([
      { sub: "118212345678901234567", email: "ada@example.com" },
      { email: "bob@example.com" },
    ]);
    const stamped = parseFrame(JSON.stringify({
      kind: "inbound",
      text: "hi",
      user_id: "118212345678901234567",
      email: "Ada@Example.com",
    }));
    expect(stamped.ok && stamped.frame.email).toBe("ada@example.com");
  });

  it("keeps mailbox seq and at and ignores junk order", () => {
    const got = parseFrame(JSON.stringify({ text: "hi", id: "m1", seq: 3, at: 1_700_000_000_000 }));
    expect(got.ok && got.frame.seq).toBe(3);
    expect(got.ok && got.frame.at).toBe(1_700_000_000_000);
    const junk = parseFrame(JSON.stringify({ text: "hi", seq: 0, at: -1 }));
    expect(junk.ok).toBe(true);
    if (junk.ok) {
      expect(junk.frame.seq).toBeUndefined();
      expect(junk.frame.at).toBeUndefined();
    }
    expect(stampOrderOnBody('{"text":"hi","id":"m1"}', { seq: 4, at: 9 })).toBe(
      encodeFrame({ text: "hi", id: "m1", seq: 4, at: 9 }),
    );
    expect(stripClientOrder({ text: "hi", seq: 9, at: 1, replay: true })).toEqual({ text: "hi" });
    expect(parseFrame(JSON.stringify({ text: "hi", replay: true })).ok).toBe(true);
    const replay = parseFrame(JSON.stringify({ text: "hi", kind: "reply", replay: true }));
    expect(replay.ok && replay.frame.replay).toBe(true);
    expect(stampReplayOnBody('{"text":"hi","kind":"reply"}')).toBe(
      encodeFrame({ text: "hi", kind: "reply", replay: true }),
    );
  });

  it("parses and encodes a short frame id", () => {
    const got = parseFrame(JSON.stringify({ text: "hi", id: "msg-1" }));
    expect(got.ok && got.frame.id).toBe("msg-1");
    if (got.ok) {
      expect(JSON.parse(encodeFrame(got.frame))).toEqual({ text: "hi", id: "msg-1" });
    }
    expect(parseFrame(JSON.stringify({ id: "x".repeat(129) })).ok).toBe(false);
    expect(parseFrame(JSON.stringify({ id: 1 })).ok).toBe(false);
    expect(parseFrame(JSON.stringify({ since: 1 })).ok).toBe(false);
    expect(parseFrame(JSON.stringify({ text: "hi", user_id: "ada", id: "" })).ok).toBe(true);
  });

  it("accepts a crane typing action", () => {
    const got = parseFrame(JSON.stringify({ kind: "typing", user_id: "1182" }));
    expect(got.ok && got.frame).toEqual({ kind: "typing", user_id: "1182" });
    if (got.ok) {
      expect(JSON.parse(encodeFrame(got.frame))).toEqual({ kind: "typing", user_id: "1182" });
    }
  });

  it("accepts a crane draft bubble", () => {
    const got = parseFrame(JSON.stringify({
      kind: "draft",
      user_id: "1182",
      text: "⏳ spinning up",
    }));
    expect(got.ok && got.frame).toEqual({
      kind: "draft",
      user_id: "1182",
      text: "⏳ spinning up",
    });
  });

  it("keeps ack id and optional since", () => {
    const got = parseFrame(JSON.stringify({ kind: "ack", id: "msg-1", since: "msg-0" }));
    expect(got.ok && got.frame).toEqual({ kind: "ack", id: "msg-1", since: "msg-0" });
    if (got.ok) {
      expect(JSON.parse(encodeFrame(got.frame))).toEqual({ kind: "ack", id: "msg-1", since: "msg-0" });
    }
  });

  it("rejects https images from the phone and still allows data urls", () => {
    const https = parseFrame(JSON.stringify({ images: [{ url: "https://example.test/a.jpg" }] }), { role: "phone" });
    expect(https.ok).toBe(false);
    const data = parseFrame(JSON.stringify({ images: [{ url: "data:image/jpeg;base64,aa" }] }), { role: "phone" });
    expect(data.ok).toBe(true);
  });

  it("echoes a valid id on a parse refusal so the mouth can mark that bubble", () => {
    const fat = parseFrame(JSON.stringify({
      id: "photo-1",
      kind: "inbound",
      images: [{ url: `data:image/jpeg;base64,${"a".repeat(1_500_001)}` }],
    }), { role: "phone" });
    expect(failMsg(fat)).toBe("too large");
    expect(fat.ok ? undefined : fat.id).toBe("photo-1");
    const two = parseFrame(JSON.stringify({
      id: "two",
      images: [{ url: "https://a" }, { url: "https://b" }],
    }));
    expect(two).toEqual({ ok: false, error: "too large", id: "two" });
    const junk = parseFrame("nope");
    expect(junk.ok || "id" in junk).toBe(false);
    const huge = parseFrame("x".repeat(FRAME_BYTES_MAX + 1));
    expect(huge.ok || "id" in huge).toBe(false);
  });

  it("encodes a refusal without an id key when the sender had none", () => {
    expect(JSON.parse(encodeError("rate"))).toEqual({ kind: "error", text: "rate" });
    expect(JSON.parse(encodeError("bad frame", "msg-1"))).toEqual({ kind: "error", text: "bad frame", id: "msg-1" });
  });

  it("allows https images from the crane", () => {
    const crane = parseFrame(JSON.stringify({ images: [{ url: "https://example.test/a.jpg" }] }), { role: "crane" });
    expect(crane.ok).toBe(true);
  });
});
