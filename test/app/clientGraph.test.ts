import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The browser bundle must never reach a server-only module. Vite stubs
 * `node:*` in the client with a throwing getter, so one stray import of a
 * route handler takes down the page at render time (`node:crypto` via
 * `lib/chat/secret.ts` did exactly that on `/chat/kit`). This walks the static
 * import graph from every `"use client"` file and names the chain.
 */

const ROOT = resolve(import.meta.dirname, "../..");
const SERVER_ONLY = /^(node|cloudflare):/;
const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];
const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\s)[\s\S]*?\sfrom\s+["']([^"']+)["']/gm;
const SIDE_EFFECT_RE = /^\s*import\s+["']([^"']+)["']/gm;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function isClientFile(file: string): boolean {
  return /^\s*["']use client["']/.test(readFileSync(file, "utf8"));
}

function specifiers(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const re of [IMPORT_RE, SIDE_EFFECT_RE]) {
    for (const m of src.matchAll(re)) {
      const spec = m[1];
      if (spec) {
        out.push(spec);
      }
    }
  }
  return out;
}

/** Repo file for a specifier, or null for packages. Builtins come back as-is. */
function resolveSpec(from: string, spec: string): string | null {
  if (SERVER_ONLY.test(spec)) {
    return spec;
  }
  let base: string;
  if (spec.startsWith("@/")) {
    base = join(ROOT, spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = resolve(dirname(from), spec);
  } else {
    return null;
  }
  base = base.replace(/\?.*$/, "");
  for (const ext of ["", ...EXTENSIONS]) {
    const candidate = base + ext;
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      /* try the next extension */
    }
  }
  return null;
}

/** First import chain from `entry` to a server-only builtin, or null. */
function serverOnlyChain(entry: string): string[] | null {
  const seen = new Set<string>([entry]);
  const queue: string[][] = [[entry]];
  while (queue.length) {
    const chain = queue.shift();
    if (!chain) {
      break;
    }
    const file = chain[chain.length - 1];
    if (!file) {
      continue;
    }
    for (const spec of specifiers(file)) {
      const next = resolveSpec(file, spec);
      if (!next) {
        continue;
      }
      if (SERVER_ONLY.test(next)) {
        return [...chain, next];
      }
      if (!seen.has(next)) {
        seen.add(next);
        queue.push([...chain, next]);
      }
    }
  }
  return null;
}

describe("client import graph", () => {
  const clientFiles = walk(join(ROOT, "app")).filter(isClientFile);

  it("finds the client components", () => {
    expect(clientFiles.length).toBeGreaterThan(20);
  });

  it("never reaches a node: or cloudflare: builtin from a \"use client\" file", () => {
    const leaks = clientFiles
      .map((file) => serverOnlyChain(file))
      .filter((chain): chain is string[] => chain !== null)
      .map((chain) => chain.map((p) => (SERVER_ONLY.test(p) ? p : relative(ROOT, p))).join(" → "));
    expect(leaks).toEqual([]);
  });

  it("catches the backdrop → handler → secret chain if it comes back", () => {
    const handler = join(ROOT, "lib/backdrop/http.ts");
    const chain = serverOnlyChain(handler);
    expect(chain?.at(-1)).toBe("node:crypto");
    const backdrop = join(ROOT, "app/components/chat/Backdrop.tsx");
    expect(serverOnlyChain(backdrop)).toBeNull();
  });
});
