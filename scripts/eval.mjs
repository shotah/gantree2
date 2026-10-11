#!/usr/bin/env node
/**
 * Live behavioral eval. Loads `.dev.vars` (LLM_BASE_URL, LLM_API_KEY,
 * LLM_MODEL) without printing them, then runs the Vitest eval config.
 * Existing environment wins, so CI secrets are not overwritten.
 *
 *   EVAL_N=1 EVAL_ONLY=scoop_at_2 npm run eval
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadDevVars(path) {
  if (!existsSync(path)) {
    return;
  }
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = body.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDevVars(join(root, ".dev.vars"));

const child = spawn(
  process.execPath,
  [join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "vitest.eval.config.ts"],
  { cwd: root, stdio: "inherit", env: process.env },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 1);
});
