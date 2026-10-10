/**
 * `harness/mcp.lock` rows. Tab-separated: id, path, module, binary, needs
 * (comma list or `-`), optional home_only. `#` comments and blank lines skip.
 */
import lockText from "../../harness/mcp.lock?raw";

export type LockRow = {
  id: string;
  path: string;
  module: string;
  binary: string;
  needs: string[];
  homeOnly: boolean;
};

function homeOnlyFlag(raw: string | undefined): boolean {
  switch ((raw ?? "").trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "home_only":
      return true;
    default:
      return false;
  }
}

function parseNeeds(raw: string): string[] {
  const text = raw.trim();
  if (!text || text === "-") {
    return [];
  }
  return text.split(",").map((key) => key.trim()).filter((key) => key.length > 0);
}

/** Parse lock text. Throws on a data line that is not 5 or 6 columns. */
export function parseLock(text: string): LockRow[] {
  const rows: LockRow[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const cols = line.split("\t").map((col) => col.trim());
    if (cols.length < 5 || cols.length > 6) {
      throw new Error(`mcp.lock:${i + 1}: expected 5 or 6 columns`);
    }
    const [id, path, module, binary, needs] = cols;
    if (!id || !path || !module || !binary) {
      throw new Error(`mcp.lock:${i + 1}: id, path, module, and binary are required`);
    }
    rows.push({
      id,
      path,
      module,
      binary,
      needs: parseNeeds(needs ?? ""),
      homeOnly: homeOnlyFlag(cols[5]),
    });
  }
  return rows;
}

/** Lock shipped with the image, in file order. */
export function loadLock(): LockRow[] {
  return parseLock(lockText);
}
