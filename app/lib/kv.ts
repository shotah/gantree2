import { clear, createStore, del, get, set } from "idb-keyval";

/**
 * On-device key/value for what the socket would otherwise repaint from blank on
 * every load: the room's face and wallpaper bytes, and the last thread. IndexedDB,
 * not localStorage — photos and JPEGs do not fit a 5 MB string quota. Get, set, and
 * delete swallow failure (no `indexedDB`, private mode, quota): a miss just means the
 * mailbox paints it, same as before. Clear rejects on a thrown write so logout can
 * still post.
 */

const DB = "gantree";
const TABLE = "kv";

type Table = ReturnType<typeof createStore>;

let table: Table | null | undefined;

function open(): Table | null {
  if (table !== undefined) {
    return table;
  }
  try {
    table = typeof indexedDB === "undefined" ? null : createStore(DB, TABLE);
  } catch {
    table = null;
  }
  return table;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const t = open();
  if (!t) {
    return undefined;
  }
  try {
    return await get<T>(key, t);
  } catch {
    return undefined;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const t = open();
  if (!t) {
    return;
  }
  try {
    await set(key, value, t);
  } catch {
    // quota / private mode: the mailbox is still the source of truth
  }
}

export async function kvDel(key: string): Promise<void> {
  const t = open();
  if (!t) {
    return;
  }
  try {
    await del(key, t);
  } catch {
    // nothing to drop
  }
}

/** Drop every row. A missing `indexedDB` resolves; a thrown clear rejects. */
export async function kvClear(): Promise<void> {
  const t = open();
  if (!t) {
    return;
  }
  await clear(t);
}
