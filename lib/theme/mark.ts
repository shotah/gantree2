/**
 * The tree mark as drawable parts. `assets/tree.svg` is the traced source
 * (one path, 1264×1280 pt); `assets/logo.svg` scales it into a 64-box and
 * hangs the orange. This mirrors that geometry so React can paint the
 * tree in `currentColor` and the orange in the theme accent.
 */
import treeSvg from "../../assets/tree.svg?raw";

/** The 64-box every raster is cut from. */
export const MARK_BOX = 64;

/** Tree transform inside the box — same numbers as `assets/logo.svg`. */
export const MARK_TREE_TRANSFORM = "translate(1.2 3.2) scale(0.044)";
export const MARK_TREE_INNER_TRANSFORM = "translate(0,1280) scale(0.1,-0.1)";

/** Where the orange hangs. */
export const MARK_ORANGE = { x: 55.41, stringTop: 25.11, stringBottom: 33.31, cy: 34.57, r: 3.6 } as const;

/** The path `d` out of an SVG with one `<path>`. Empty string when there is none. */
export function pathData(svg: string): string {
  const m = /<path\b[^>]*\bd="([^"]*)"/.exec(svg);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

export const TREE_PATH = pathData(treeSvg);
