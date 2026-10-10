/**
 * Shot table for `scripts/shot.mjs`. Pure: no Chrome, no network.
 */
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Flatpak Chrome on the dev box. `CHROME_BIN` overrides it. */
export const DEFAULT_CHROME = "/var/lib/flatpak/app/com.google.Chrome/current/active/files/extra/chrome";

export const SESSION_COOKIE = "gantree_session";
export const MEMBER_COOKIE_NAME = "gantree2-member-cookie";

export const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false };
export const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true };

export type Viewport = {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
};

export type ShotSpec = {
  path: string;
  text: string;
  signedOut?: boolean;
  phone?: boolean;
  member?: boolean;
  open?: readonly string[];
  full?: boolean;
  waitMs?: number;
};

export const SHOTS = {
  login: { path: "/login", text: "Continue with Google", signedOut: true },
  agents: { path: "/agents", text: "Kit" },
  "agents-kit": { path: "/agents/kit", text: "maps", open: ["Log", "Who can chat"], full: true },
  "agents-new": { path: "/agents/new", text: "New agent" },
  users: { path: "/users", text: "sam@example.com" },
  settings: { path: "/settings", text: "Settings" },
  profile: { path: "/profile", text: "Profile" },
  "chat-kit": { path: "/chat/kit", text: "ferry building", phone: true },
  chat: { path: "/chat", text: "Kit", phone: true, member: true },
} as const satisfies Record<string, ShotSpec>;

export type ShotName = keyof typeof SHOTS;

export function chromeBin(env?: { CHROME_BIN?: string; CHROME?: string }): string {
  const source = env ?? {
    CHROME_BIN: process.env.CHROME_BIN,
    CHROME: process.env.CHROME,
  };
  return source.CHROME_BIN || source.CHROME || DEFAULT_CHROME;
}

export function viewportFor(phone: boolean): Viewport {
  return phone ? PHONE : DESKTOP;
}

export function shotFile(name: string): string {
  return `${name}.png`;
}

export function parseShotArgs(argv: readonly string[]): { base: string; names: ShotName[] } {
  const first = argv[0] ?? "";
  const hasBase = first.startsWith("http://") || first.startsWith("https://");
  const base = hasBase ? first : "http://127.0.0.1:3000";
  const names = hasBase ? argv.slice(1) : [...argv];
  const wanted = names.length > 0 ? names : (Object.keys(SHOTS) as ShotName[]);
  for (const name of wanted) {
    if (!Object.hasOwn(SHOTS, name)) {
      throw new Error(`unknown shot ${name}`);
    }
  }
  return { base, names: wanted as ShotName[] };
}

export function memberCookieFile(): string {
  return join(tmpdir(), MEMBER_COOKIE_NAME);
}
