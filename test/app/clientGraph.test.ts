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

function isWord(ch: string | undefined): boolean {
  if (!ch) return false;
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === "_" || ch === "$";
}

function nextStatement(src: string, from: number): number {
  let i = from;
  if (i > 0 && src[i - 1] !== "\n") {
    const nl = src.indexOf("\n", i);
    if (nl < 0) return -1;
    i = nl + 1;
  }
  while (i < src.length) {
    let j = i;
    while (src[j] === " " || src[j] === "\t") j += 1;
    if ((src.startsWith("import", j) && !isWord(src[j + 6])) || (src.startsWith("export", j) && !isWord(src[j + 6]))) {
      return j;
    }
    const nl = src.indexOf("\n", i);
    if (nl < 0) return -1;
    i = nl + 1;
  }
  return -1;
}

function specifierAfter(src: string, kwEnd: number): string | null {
  if (src[kwEnd] === "(") return null;
  let i = kwEnd;
  let depth = 0;
  while (i < src.length) {
    const c = src[i] ?? "";
    if (c === "{") {
      depth += 1;
    } else if (c === "}") {
      depth = Math.max(0, depth - 1);
    } else if (c === ";" && depth === 0) {
      return null;
    } else if (c === "\n" && depth === 0) {
      let j = i + 1;
      while (src[j] === " " || src[j] === "\t") j += 1;
      const word = src.slice(j, j + 9);
      if (/^(?:import|export|const|let|var|function|class|type|interface)\b/.test(word)) return null;
    } else if (depth === 0 && isModuleFrom(src, i)) {
      return readQuoted(src, i + 4);
    }
    i += 1;
  }
  return null;
}

function isModuleFrom(src: string, i: number): boolean {
  if (!src.startsWith("from", i) || isWord(src[i - 1])) return false;
  let j = i + 4;
  if (src[j] !== " " && src[j] !== "\t" && src[j] !== "\n" && src[j] !== "\r") return false;
  while (src[j] === " " || src[j] === "\t" || src[j] === "\n" || src[j] === "\r") j += 1;
  return src[j] === "\"" || src[j] === "'";
}

function readQuoted(src: string, i: number): string | null {
  while (src[i] === " " || src[i] === "\t" || src[i] === "\n" || src[i] === "\r") i += 1;
  const q = src[i];
  if (q !== "\"" && q !== "'") return null;
  const end = src.indexOf(q, i + 1);
  if (end < 0) return null;
  return src.slice(i + 1, end);
}

function specifiers(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  let cursor = 0;
  while (cursor < src.length) {
    const at = nextStatement(src, cursor);
    if (at < 0) break;
    const keyword = src.startsWith("import", at) ? "import" : "export";
    const after = at + keyword.length;
    const lineEnd = src.indexOf("\n", after);
    const rest = src.slice(after, lineEnd === -1 ? src.length : lineEnd).trimStart();
    const reexport = rest.startsWith("{") || rest.startsWith("*");
    const valueImport = keyword === "import" || reexport;
    if (valueImport && !rest.startsWith("type ") && !rest.startsWith("type{")) {
      const spec = specifierAfter(src, after);
      if (spec) out.push(spec);
    }
    cursor = after + 1;
  }
  for (const m of src.matchAll(SIDE_EFFECT_RE)) {
    if (m[1]) out.push(m[1]);
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
