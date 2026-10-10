import { describe, expect, it } from "vitest";
import { SESSION_COOKIE as DOOR_COOKIE } from "@/lib/door/session";
import { MEMBER_COOKIE_NAME as SEED_COOKIE_FILE } from "@/scripts/seed";
import {
  DEFAULT_CHROME,
  DESKTOP,
  MEMBER_COOKIE_NAME,
  PHONE,
  SESSION_COOKIE,
  SHOTS,
  chromeBin,
  parseShotArgs,
  shotFile,
  viewportFor,
} from "@/scripts/shots";

describe("shot table", () => {
  it("maps every console page to a png name", () => {
    expect(Object.keys(SHOTS)).toEqual([
      "login",
      "agents",
      "agents-kit",
      "agents-new",
      "users",
      "settings",
      "profile",
      "chat-kit",
      "chat",
    ]);
    expect(shotFile("agents-kit")).toBe("agents-kit.png");
    expect(SHOTS.login.path).toBe("/login");
    expect(SHOTS.login.signedOut).toBe(true);
    expect(SHOTS["agents-kit"].path).toBe("/agents/kit");
    expect(SHOTS["chat-kit"].path).toBe("/chat/kit");
    expect(SHOTS.chat.path).toBe("/chat");
    expect(SHOTS["chat-kit"].phone).toBe(true);
    expect(SHOTS.chat.phone).toBe(true);
    expect(SHOTS.chat.member).toBe(true);
  });

  it("defaults to the whole table and rejects an unknown name", () => {
    expect(parseShotArgs([]).names).toEqual(Object.keys(SHOTS));
    expect(parseShotArgs([]).base).toBe("http://127.0.0.1:3000");
    expect(parseShotArgs(["http://127.0.0.1:3001", "login"]).names).toEqual(["login"]);
    expect(parseShotArgs(["http://127.0.0.1:3001", "login"]).base).toBe("http://127.0.0.1:3001");
    expect(() => parseShotArgs(["nope"])).toThrow(/unknown shot nope/);
  });

  it("uses the phone preset only for phone shots", () => {
    expect(viewportFor(true)).toEqual(PHONE);
    expect(PHONE).toEqual({ width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    expect(viewportFor(false)).toEqual(DESKTOP);
    expect(DESKTOP.mobile).toBe(false);
    expect(DESKTOP.width).toBe(1440);
  });

  it("prefers CHROME_BIN over the flatpak default", () => {
    expect(chromeBin({})).toBe(DEFAULT_CHROME);
    expect(chromeBin({ CHROME: "/opt/chrome" })).toBe("/opt/chrome");
    expect(chromeBin({ CHROME: "/opt/chrome", CHROME_BIN: "/usr/bin/chrome" })).toBe("/usr/bin/chrome");
    expect(DEFAULT_CHROME).toContain("com.google.Chrome");
  });

  it("shares the session cookie name and the member cookie file name", () => {
    expect(SESSION_COOKIE).toBe(DOOR_COOKIE);
    expect(MEMBER_COOKIE_NAME).toBe(SEED_COOKIE_FILE);
  });
});
