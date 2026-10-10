import { describe, expect, it } from "vitest";
import { FOLLOW_THEME_PREF_KEY } from "@/app/lib/prefs";
import { THEME_KEY } from "@/app/lib/theme";
import { SESSION_COOKIE as DOOR_COOKIE } from "@/lib/door/session";
import { MEMBER_COOKIE_NAME as SEED_COOKIE_FILE } from "@/scripts/seed";
import {
  DEFAULT_CHROME,
  DEFAULT_SHOT_THEME,
  DESKTOP,
  MEMBER_COOKIE_NAME,
  PHONE,
  SESSION_COOKIE,
  SHOT_FOLLOW_KEY,
  SHOT_THEME_KEY,
  SHOTS,
  chromeBin,
  parseShotArgs,
  shotFile,
  shotTheme,
  themeSeedScript,
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

  it("shoots in a mood theme: neon by default, env or spec override, unknown ignored", () => {
    expect(DEFAULT_SHOT_THEME).toBe("neon");
    expect(shotTheme(SHOTS.login)).toBe("neon");
    expect(shotTheme(SHOTS.login, { GANTREE_SHOT_THEME: "marquee" })).toBe("marquee");
    expect(shotTheme(SHOTS.login, { GANTREE_SHOT_THEME: "plaid" })).toBe("neon");
    expect(shotTheme({ path: "/", text: "x", theme: "boom" }, { GANTREE_SHOT_THEME: "marquee" })).toBe("boom");
  });

  it("seeds the browser with the human's pick and turns room follow off", () => {
    expect(SHOT_THEME_KEY).toBe(THEME_KEY);
    expect(SHOT_FOLLOW_KEY).toBe(FOLLOW_THEME_PREF_KEY);
    const script = themeSeedScript("neon");
    expect(script).toContain('localStorage.setItem("gantree.theme","neon")');
    expect(script).toContain('localStorage.setItem("gantree.followTheme","off")');
    expect(script.startsWith("try{")).toBe(true);
  });
});
