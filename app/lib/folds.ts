/**
 * Which folds a person left open or shut, per page, in this browser.
 * One JSON map per group: `gantree.folds.<group>` → `{ "<fold title>": boolean }`.
 */
export const FOLDS_KEY_PREFIX = "gantree.folds.";

type Getter = { getItem(key: string): string | null };
type Setter = Getter & { setItem(key: string, value: string): void };

export function foldsKey(group: string): string {
  return `${FOLDS_KEY_PREFIX}${group}`;
}

/** Junk, missing, or a throwing storage → an empty map. */
export function readFolds(storage: Getter | null | undefined, group: string): Record<string, boolean> {
  let raw: string | null;
  try {
    raw = storage?.getItem(foldsKey(group)) ?? null;
  } catch {
    return {};
  }
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, boolean> = {};
    for (const [title, open] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof open === "boolean") {
        out[title] = open;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Merge one fold's state into the group's map. A storage that throws (private mode, quota) is ignored. */
export function writeFold(storage: Setter | null | undefined, group: string, title: string, open: boolean): void {
  if (!storage) {
    return;
  }
  const next = { ...readFolds(storage, group), [title]: open };
  try {
    storage.setItem(foldsKey(group), JSON.stringify(next));
  } catch {
    // Nothing to do: the fold still works, it just will not be remembered.
  }
}
