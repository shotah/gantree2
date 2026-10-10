import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { avatarRequestPath } from "@/lib/avatar/path";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = join(ROOT, spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = resolve(dirname(from), spec);
  } else {
    return null;
  }
  for (const ext of ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"]) {
    const next = base + ext;
    if (existsSync(next) && statSync(next).isFile()) {
      return next;
    }
  }
  return null;
}

/** Value imports reachable from a client entry. `import type` is erased. */
export function clientValueImports(entry: string): string[] {
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file) || !existsSync(file) || file.includes("node_modules")) {
      return;
    }
    seen.add(file);
    const text = readFileSync(file, "utf8");
    const re = /import[\s\S]*?from\s+["']([^"']+)["']/g;
    let match = re.exec(text);
    while (match) {
      const stmt = match[0];
      const spec = match[1];
      if (spec && !/^import\s+type\b/.test(stmt)) {
        const next = resolveSpec(file, spec);
        if (next) {
          walk(next);
        }
      }
      match = re.exec(text);
    }
  };
  walk(entry);
  return [...seen];
}

describe("avatarRequestPath", () => {
  it("stays a relative URL the browser can fetch", () => {
    expect(avatarRequestPath({ slug: "kit", rev: 3 })).toBe("/api/chat/avatar?slug=kit&v=3");
  });
});

describe("chat client boundary", () => {
  it("does not pull the room bearer into the phone", () => {
    const phone = join(ROOT, "app/components/chat/PhoneShell.tsx");
    const files = clientValueImports(phone);
    const leaked = files.filter((file) => file.endsWith("lib/chat/secret.ts") || file.endsWith("lib/chat/bearer.ts"));
    expect(leaked).toEqual([]);
  });
});
