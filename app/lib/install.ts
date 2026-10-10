/** Chrome / iOS install surfaces. Manifest rules live in `pwa.ts`. */

export type DisplayMedia = {
  matchMedia(query: string): { matches: boolean };
};

export type StandaloneNav = {
  standalone?: boolean;
};

export type InstallChoice = {
  prompt: () => Promise<void>;
};

export const INSTALL_HINT_KEY = "gantree.install";

type Getter = { getItem(key: string): string | null };
type Setter = { setItem(key: string, value: string): void };

/** Default on. Only `"off"` hides the header Install hint. */
export function installHintOn(storage: Getter | null | undefined): boolean {
  return storage?.getItem(INSTALL_HINT_KEY) !== "off";
}

export function writeInstallHint(storage: Setter, on: boolean): void {
  storage.setItem(INSTALL_HINT_KEY, on ? "on" : "off");
}

type PromptEvent = Event & {
  prompt: () => Promise<unknown>;
};

export function isStandalone(
  media: { matchMedia?: DisplayMedia["matchMedia"] },
  nav: object,
): boolean {
  if (typeof media.matchMedia === "function") {
    if (media.matchMedia("(display-mode: standalone)").matches) {
      return true;
    }
    if (media.matchMedia("(display-mode: fullscreen)").matches) {
      return true;
    }
    if (media.matchMedia("(display-mode: minimal-ui)").matches) {
      return true;
    }
  }
  return "standalone" in nav && (nav as StandaloneNav).standalone === true;
}

export function isIos(nav: Pick<Navigator, "userAgent">): boolean {
  return /iPhone|iPad|iPod/i.test(nav.userAgent);
}

/**
 * Under "Continue with Google". iOS 16.7+ copies Safari's cookies into a new
 * Home Screen app, so on an iPhone the order is sign in, then add. `retry` is
 * the callback bounce (`/?auth=retry`): the Home Screen app got the loser of
 * iOS's twin callback delivery, or Google really did fail. `denied`
 * (`/?auth=denied`) is a real Google account that no crane lists.
 */
export function signInHint(opts: { ios: boolean; standalone: boolean; retry: boolean; denied?: boolean }): string {
  if (opts.denied) {
    return "That Google account isn't on any agent's list. Ask the operator to add it, then sign in again.";
  }
  if (opts.retry) {
    return opts.ios && opts.standalone
      ? "Google didn't finish. Try again, or open gantree in Safari, sign in there, then Add to Home Screen again."
      : "Google didn't finish. Try again.";
  }
  if (opts.ios && !opts.standalone) {
    return "Sign in here first, then Share → Add to Home Screen. The app keeps the sign-in.";
  }
  return "";
}

/** Pendant bounce (`?auth=retry|denied`) and the door (`?error=`). */
export function authRetryFromQuery(q: { get(name: string): string | null }): boolean {
  const error = q.get("error");
  return q.get("auth") === "retry" || error === "exchange" || error === "state" || error === "token" || error === "expired";
}

export function authDeniedFromQuery(q: { get(name: string): string | null }): boolean {
  return q.get("auth") === "denied" || q.get("error") === "not_allowed";
}

export function listenInstallPrompt(
  onChange: (choice: InstallChoice | null) => void,
  target: EventTarget,
): () => void {
  function onBefore(ev: Event) {
    const prompt = (ev as PromptEvent).prompt;
    if (typeof prompt !== "function") {
      return;
    }
    ev.preventDefault();
    onChange({
      prompt: async () => {
        await prompt.call(ev);
        onChange(null);
      },
    });
  }
  function onInstalled() {
    onChange(null);
  }
  target.addEventListener("beforeinstallprompt", onBefore);
  target.addEventListener("appinstalled", onInstalled);
  return () => {
    target.removeEventListener("beforeinstallprompt", onBefore);
    target.removeEventListener("appinstalled", onInstalled);
  };
}
