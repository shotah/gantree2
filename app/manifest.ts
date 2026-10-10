import { GANTREE_MANIFEST } from "./lib/pwa";

/** Vinext metadata route → `/manifest.webmanifest` (`application/manifest+json`). */
export default function manifest() {
  return GANTREE_MANIFEST;
}
