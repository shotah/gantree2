/** Short age for a millisecond timestamp. Null and non-finite values read as an em dash. */
export function relativeTime(at: number | null, now = Date.now()): string {
  if (at === null || !Number.isFinite(at)) {
    return "—";
  }
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}

export function timeStamp(at: number | null): string | undefined {
  if (at === null || !Number.isFinite(at)) {
    return undefined;
  }
  return new Date(at).toISOString();
}
