import { errorMessage, isRecord } from "./json";

export const FETCH_CAP = 4;

/** Run `fn` over `items` with at most `limit` in flight. Result order matches `items`. */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Math.min(Math.max(limit, 0), items.length);
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      out[index] = await fn(item);
    }
  }
  if (workers === 0) return out;
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

export function withDate(date: string, value: unknown): Record<string, unknown> {
  if (isRecord(value)) return { date, ...value };
  return { date, value };
}

/** One row per day. An upstream failure is `{ date, error }`, not a failed call. */
export async function eachDay(
  dates: readonly string[],
  load: (date: string) => Promise<unknown>,
): Promise<Record<string, unknown>[]> {
  return mapPool(dates, FETCH_CAP, async (date) => {
    try {
      return withDate(date, await load(date));
    } catch (err) {
      return { date, error: errorMessage(err) };
    }
  });
}
