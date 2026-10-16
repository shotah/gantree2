import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { chromeInstallIssues, GANTREE_MANIFEST, swInstallIssues, type WebAppManifest } from "@/app/lib/pwa";
import { NOTIFY_ICON } from "@/lib/phone/notify";
import { isPublicPath } from "@/lib/door/gate";

describe("pwa", () => {
  it("keeps every install and notification icon outside the door", () => {
    // Chrome fetches manifest icons without cookies before it offers Install; a
    // 302 to /login there means no beforeinstallprompt and no Install menu item.
    for (const icon of GANTREE_MANIFEST.icons) {
      expect(isPublicPath(icon.src), icon.src).toBe(true);
    }
    expect(isPublicPath(NOTIFY_ICON)).toBe(true);
    expect(isPublicPath("/apple-touch-icon.png")).toBe(true);
    const sw = readFileSync("public/sw.js", "utf8");
    for (const src of sw.matchAll(/(?:icon|badge):\s*"([^"]+)"/g)) {
      expect(isPublicPath(src[1] ?? ""), src[1]).toBe(true);
    }
  });

  it("meets Chrome's installable-manifest rules", () => {
    expect(chromeInstallIssues(GANTREE_MANIFEST)).toEqual([]);
    expect(manifest()).toBe(GANTREE_MANIFEST);
    expect(GANTREE_MANIFEST.name).toBe("gantree");
    expect(GANTREE_MANIFEST.theme_color).toBe("#0e1316");
    expect(GANTREE_MANIFEST.display).toBe("standalone");
    expect(GANTREE_MANIFEST.start_url).toBe("/");
    expect(GANTREE_MANIFEST.icons.some((i) => i.src === "/icon.svg")).toBe(true);
    expect(GANTREE_MANIFEST.shortcuts.map((s) => s.url)).toEqual(["/#compose", "/?pin=1"]);
    const sw = readFileSync("public/sw.js", "utf8");
    expect(swInstallIssues(sw)).toEqual([]);
    expect(sw).toMatch(/notificationclick/);
    expect(sw).toMatch(/addEventListener\(\s*"push"/);
  });

  it("names the gaps Chromium cares about", () => {
    const empty: WebAppManifest = {};
    expect(chromeInstallIssues(empty)).toEqual([
      "need name or short_name",
      "need start_url",
      "display must be standalone, fullscreen, minimal-ui, or window-controls-overlay",
      "need a 192x192 PNG icon",
      "need a 512x512 PNG icon",
    ]);
    expect(chromeInstallIssues({
      ...GANTREE_MANIFEST,
      display: "browser",
      prefer_related_applications: true,
      icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
    })).toEqual([
      "display must be standalone, fullscreen, minimal-ui, or window-controls-overlay",
      "prefer_related_applications must be false or omitted",
      "need a 192x192 PNG icon",
      "need a 512x512 PNG icon",
    ]);
    expect(swInstallIssues("self.addEventListener(\"install\", () => {});")).toEqual([
      "need a fetch handler",
      "fetch handler must skip non-navigation requests",
    ]);
  });
});
