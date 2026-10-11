#!/usr/bin/env node
/**
 * Shields-style coverage badge. One input, one SVG.
 *
 *   node scripts/badge.mjs vitest  coverage/coverage-summary.json  badges/coverage.svg  [label]
 *
 * `vitest` reads `total.lines.pct` from `--coverage.reporter=json-summary`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function pctFromVitestSummary(json) {
  const pct = json?.total?.lines?.pct;
  if (typeof pct !== "number" || !Number.isFinite(pct)) {
    throw new Error("vitest summary has no total.lines.pct");
  }
  return pct;
}

export function badgeColor(pct) {
  if (pct >= 80) {
    return "#4c1";
  }
  if (pct >= 60) {
    return "#97ca00";
  }
  if (pct >= 40) {
    return "#a4a61d";
  }
  return "#e05d44";
}

/** Approximate DejaVu Sans 11px advance, same as shields' flat style. */
function textWidth(s) {
  return Math.round([...s].reduce((w, c) => w + (/[mwMW]/.test(c) ? 9.5 : /[il.:' ]/.test(c) ? 3.5 : 6.5), 0));
}

export function badgeSvg({ label, pct }) {
  const value = `${Math.round(pct)}%`;
  const color = badgeColor(pct);
  const lw = textWidth(label) + 10;
  const vw = textWidth(value) + 10;
  const w = lw + vw;
  const lx = lw / 2;
  const vx = lw + vw / 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="a"><rect width="${w}" height="20" rx="3" fill="#fff"/></mask>
  <g mask="url(#a)">
    <path fill="#555" d="M0 0h${lw}v20H0z"/>
    <path fill="${color}" d="M${lw} 0h${vw}v20H${lw}z"/>
    <path fill="url(#b)" d="M0 0h${w}v20H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${lx}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${lx}" y="14">${label}</text>
    <text x="${vx}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${vx}" y="14">${value}</text>
  </g>
</svg>
`;
}

export function pctFromFile(kind, path) {
  const text = readFileSync(path, "utf8");
  if (kind === "vitest") {
    return pctFromVitestSummary(JSON.parse(text));
  }
  throw new Error(`unknown input kind: ${kind}`);
}

export function main(argv) {
  const [kind, input, out, label = "coverage"] = argv;
  if (!kind || !input || !out) {
    throw new Error("usage: badge.mjs vitest <input> <out.svg> [label]");
  }
  const pct = pctFromFile(kind, input);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, badgeSvg({ label, pct }));
  return { pct, out };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { pct, out } = main(process.argv.slice(2));
    process.stdout.write(`wrote ${out} (${Math.round(pct)}%)\n`);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
