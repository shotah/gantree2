import { describe, expect, it, vi } from "vitest";
import {
  INSTALL_HINT_KEY,
  installHintOn,
  isIos,
  isStandalone,
  listenInstallPrompt,
  signInHint,
  writeInstallHint,
} from "@/app/lib/install";

describe("install", () => {
  it("treats standalone display-mode as installed", () => {
    expect(isStandalone({ matchMedia: () => ({ matches: true }) }, {})).toBe(true);
    expect(isStandalone({
      matchMedia: (q) => ({ matches: q === "(display-mode: standalone)" }),
    }, {})).toBe(true);
    expect(isStandalone({ matchMedia: () => ({ matches: false }) }, { standalone: true })).toBe(true);
    expect(isStandalone({ matchMedia: () => ({ matches: false }) }, {})).toBe(false);
    expect(isStandalone({}, {})).toBe(false);
  });

  it("detects iOS from the UA", () => {
    expect(isIos({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" })).toBe(true);
    expect(isIos({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131" })).toBe(false);
  });

  it("stashes beforeinstallprompt and clears after prompt()", async () => {
    const target = new EventTarget();
    const onChange = vi.fn();
    const stop = listenInstallPrompt(onChange, target);
    const prompt = vi.fn().mockResolvedValue({ outcome: "accepted" });
    const ev = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(ev, { prompt });
    target.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    await onChange.mock.calls[0][0].prompt();
    expect(prompt).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenLastCalledWith(null);
    target.dispatchEvent(new Event("appinstalled"));
    expect(onChange).toHaveBeenLastCalledWith(null);
    stop();
  });

  it("tells iPhone Safari to sign in before Add to Home Screen", () => {
    expect(signInHint({ ios: true, standalone: false, retry: false }))
      .toBe("Sign in here first, then Share → Add to Home Screen. The app keeps the sign-in.");
    expect(signInHint({ ios: false, standalone: false, retry: false })).toBe("");
    expect(signInHint({ ios: true, standalone: true, retry: false })).toBe("");
  });

  it("explains a bounced Google round-trip, with the Safari route on an iPhone app", () => {
    expect(signInHint({ ios: false, standalone: false, retry: true })).toBe("Google didn't finish. Try again.");
    expect(signInHint({ ios: true, standalone: false, retry: true })).toBe("Google didn't finish. Try again.");
    expect(signInHint({ ios: true, standalone: true, retry: true })).toBe(
      "Google didn't finish. Try again, or open gantree in Safari, sign in there, then Add to Home Screen again.",
    );
  });

  it("names the real reason when Google signed them in but no crane lists the account", () => {
    const want = "That Google account isn't on any agent's list. Ask the operator to add it, then sign in again.";
    expect(signInHint({ ios: false, standalone: false, retry: false, denied: true })).toBe(want);
    expect(signInHint({ ios: true, standalone: true, retry: true, denied: true })).toBe(want);
  });

  it("defaults the header hint on and only treats off as dismissed", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
    };
    expect(installHintOn(null)).toBe(true);
    expect(installHintOn(storage)).toBe(true);
    writeInstallHint(storage, false);
    expect(mem.get(INSTALL_HINT_KEY)).toBe("off");
    expect(installHintOn(storage)).toBe(false);
    writeInstallHint(storage, true);
    expect(installHintOn(storage)).toBe(true);
  });
});
