#!/usr/bin/env node
/**
 * Import on-prem export JSON into a cloud agent via Wrangler remote DO bindings.
 *
 *   npm run import-onprem -- --slug kit --in onprem-kit.json --remote
 *
 * Auth: CLOUDFLARE_API_TOKEN or `npx wrangler login` (not a browser session on gantree2).
 * There is no public HTTP migrate endpoint — this script talks to the Agent DO directly.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";
import { agentStub } from "../lib/chat/location.ts";
import {
  applyOnPremBundle,
  isOnPremBundle,
  onPremBundleCounts,
  type AgentDoFetch,
} from "../lib/migrate/onprem.ts";

export const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

type ImportEnv = {
  AGENT?: DurableObjectNamespace;
  LOCATION_HINT?: string;
};

export function parseImportArgs(argv: readonly string[]): {
  help: boolean;
  slug: string;
  input: string;
  remote: boolean;
} {
  let slug = "";
  let input = "";
  let remote = false;
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--remote") {
      remote = true;
    } else if (arg.startsWith("--slug=")) {
      slug = arg.slice("--slug=".length);
    } else if (arg === "--slug") {
      slug = argv[i + 1] ?? "";
      i += 1;
    } else if (arg.startsWith("--in=")) {
      input = arg.slice("--in=".length);
    } else if (arg === "--in") {
      input = argv[i + 1] ?? "";
      i += 1;
    } else {
      throw new Error(`unknown arg ${arg}`);
    }
  }
  return { help, slug, input, remote };
}

function agentFetchForSlug(env: ImportEnv, slug: string): AgentDoFetch {
  const stub = agentStub(env, slug);
  if (!stub) {
    throw new Error("AGENT binding unavailable");
  }
  return (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    return stub.fetch(req);
  };
}

async function main(argv: string[]): Promise<void> {
  const args = parseImportArgs(argv);
  if (args.help) {
    process.stdout.write(
      "usage: import-onprem.ts --slug <slug> --in <json> --remote\n",
    );
    return;
  }
  if (!args.remote) {
    throw new Error(
      "pass --remote to import into production via Wrangler remote bindings (no local/default target)",
    );
  }
  if (!args.slug || !args.input) {
    throw new Error("usage: import-onprem.ts --slug <slug> --in <json> --remote");
  }

  const text = readFileSync(args.input, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error("input is not JSON");
  }
  if (!isOnPremBundle(raw)) {
    throw new Error("input is not a supported on-prem bundle");
  }
  const bundle = raw;
  const counts = onPremBundleCounts(bundle);

  const configPath = join(REPO_ROOT, "wrangler.jsonc");
  const proxy = await getPlatformProxy<ImportEnv>({
    configPath,
    remoteBindings: true,
    envFiles: [],
  });
  try {
    const fetchAgent = agentFetchForSlug(proxy.env, args.slug);
    await applyOnPremBundle(bundle, fetchAgent);
  } finally {
    await proxy.dispose();
  }

  process.stdout.write(
    `imported ${args.slug} memory=${String(counts.memory)} aim_event=${String(counts.aim_event)} `
    + `aim_score=${String(counts.aim_score)} aim_block=${String(counts.aim_block)} `
    + `persona_file=${String(counts.persona_file)} selfnote=${String(counts.selfnote)}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : "import failed";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
