const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function stripWrappingQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === "\"" && last === "\"") {
      return value.slice(1, -1);
    }
    if (first === "'" && last === "'") {
      return value.slice(1, -1);
    }
  }
  return value;
}

function isCommentOrBlank(trimmed: string): boolean {
  if (!trimmed) {
    return true;
  }
  const firstNonSpace = trimmed.match(/^\s*(.)/)?.[1];
  return firstNonSpace === "#";
}

export function parseEnvPaste(raw: string): { entries: { key: string; value: string }[]; skipped: string[] } {
  const skipped: string[] = [];
  const byKey = new Map<string, string>();

  for (const rawLine of raw.split("\n")) {
    let line = rawLine.replace(/\r/g, "").trim();
    if (isCommentOrBlank(line)) {
      continue;
    }
    if (line.startsWith("export ")) {
      line = line.slice("export ".length).trim();
    }
    const eq = line.indexOf("=");
    if (eq === -1) {
      skipped.push(line);
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    value = stripWrappingQuotes(value);

    if (!ENV_KEY_RE.test(key) || FORBIDDEN_KEYS.has(key)) {
      skipped.push(`Invalid key: ${key}`);
      continue;
    }
    if (!value) {
      skipped.push(`Empty value: ${key}`);
      continue;
    }
    byKey.set(key, value);
  }

  return {
    entries: [...byKey.entries()].map(([key, value]) => ({ key, value })),
    skipped,
  };
}
