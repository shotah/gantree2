/** Mirror ai-gantry `stripHarnessContext`: drop pasted clock / hydration from mouth text. */

const HARNESS_PREFIXES = ["[harness]", "[location", "[current time]", "[hours]", "[memory]"] as const;

export function harnessTagLine(line: string): boolean {
  const t = line.trim();
  return HARNESS_PREFIXES.some((p) => t.startsWith(p));
}

function harnessBlock(part: string): boolean {
  for (const line of part.split("\n")) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    return harnessTagLine(t);
  }
  return false;
}

function stripTrailingHarnessLines(part: string): string {
  const lines = part.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!harnessTagLine(lines[i] ?? "")) {
      continue;
    }
    if (i === 0) {
      return part;
    }
    return lines.slice(0, i).join("\n");
  }
  return part;
}

/** Drop pasted / old-client clock and hydration blocks so they are not stored as speech. */
export function stripHarnessContext(raw: string): string {
  const s = raw.trim();
  if (!s) {
    return "";
  }
  const kept: string[] = [];
  for (const part of s.split("\n\n")) {
    if (harnessBlock(part)) {
      continue;
    }
    const trimmed = stripTrailingHarnessLines(part).replace(/\n+$/, "");
    if (!trimmed.trim()) {
      continue;
    }
    kept.push(trimmed);
  }
  return kept.join("\n\n").trim();
}
