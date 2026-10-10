/** Chrome installability — Vinext serves this as `/manifest.webmanifest`. */

import { DEFAULT_THEME, themeOf } from "./theme";

export type ManifestIcon = {
  src: string;
  sizes?: string;
  type?: string;
  purpose?: string;
};

export type ManifestShortcut = {
  name: string;
  short_name?: string;
  url: string;
  icons?: ManifestIcon[];
};

export type WebAppManifest = {
  name?: string;
  short_name?: string;
  description?: string;
  id?: string;
  start_url?: string;
  scope?: string;
  display?: "fullscreen" | "standalone" | "minimal-ui" | "browser" | "window-controls-overlay";
  background_color?: string;
  theme_color?: string;
  prefer_related_applications?: boolean;
  icons?: ManifestIcon[];
  shortcuts?: ManifestShortcut[];
};

const INSTALLABLE_DISPLAY = new Set<WebAppManifest["display"]>([
  "fullscreen",
  "standalone",
  "minimal-ui",
  "window-controls-overlay",
]);

const canvas = themeOf(DEFAULT_THEME).tokens.canvas;

export const GANTREE_MANIFEST = {
  name: "gantree",
  short_name: "gantree",
  description: "Talk with an agent",
  id: "/",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: canvas,
  theme_color: canvas,
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
  ],
  shortcuts: [
    { name: "Message", short_name: "Message", url: "/#compose" },
    { name: "Pin", short_name: "Pin", url: "/?pin=1" },
  ],
} as const satisfies WebAppManifest;

function hasPngSize(icons: readonly ManifestIcon[] | undefined, size: string): boolean {
  return (icons ?? []).some((icon) => {
    const png = icon.type === "image/png" || /\.png$/i.test(icon.src);
    const sizes = icon.sizes?.split(/\s+/) ?? [];
    return png && sizes.includes(size);
  });
}

/** Gaps that stop Chromium firing `beforeinstallprompt` / showing Install. */
export function chromeInstallIssues(manifest: WebAppManifest): string[] {
  const issues: string[] = [];
  if (!manifest.name && !manifest.short_name) {
    issues.push("need name or short_name");
  }
  if (!manifest.start_url) {
    issues.push("need start_url");
  }
  if (!manifest.display || !INSTALLABLE_DISPLAY.has(manifest.display)) {
    issues.push("display must be standalone, fullscreen, minimal-ui, or window-controls-overlay");
  }
  if (manifest.prefer_related_applications) {
    issues.push("prefer_related_applications must be false or omitted");
  }
  if (!hasPngSize(manifest.icons, "192x192")) {
    issues.push("need a 192x192 PNG icon");
  }
  if (!hasPngSize(manifest.icons, "512x512")) {
    issues.push("need a 512x512 PNG icon");
  }
  return issues;
}

/** Chromium still treats a no-op / missing fetch listener as "not a PWA" on some builds. */
export function swInstallIssues(source: string): string[] {
  const issues: string[] = [];
  if (!/\.addEventListener\(\s*["']fetch["']/.test(source)) {
    issues.push("need a fetch handler");
  }
  if (!/request\.mode\s*!==\s*["']navigate["']/.test(source)) {
    issues.push("fetch handler must skip non-navigation requests");
  }
  return issues;
}
