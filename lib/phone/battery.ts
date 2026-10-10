export type BatteryFix = { pct: number; charging: boolean };
export type BatteryResult = { ok: true; battery: BatteryFix } | { ok: false };

export type BatteryManagerLike = {
  level: number;
  charging: boolean;
};

/** Omit when the API is missing, times out, or returns junk. Never block send. */
export function readBattery(
  getBattery: (() => Promise<BatteryManagerLike>) | undefined,
  timeoutMs = 2_000,
): Promise<BatteryResult> {
  if (!getBattery) {
    return Promise.resolve({ ok: false });
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false }), timeoutMs);
    void Promise.resolve()
      .then(() => getBattery())
      .then((b) => {
        clearTimeout(timer);
        const pct = Math.round(Number(b.level) * 100);
        if (!Number.isFinite(pct)) {
          resolve({ ok: false });
          return;
        }
        resolve({
          ok: true,
          battery: {
            pct: Math.min(100, Math.max(0, pct)),
            charging: Boolean(b.charging),
          },
        });
      })
      .catch(() => {
        clearTimeout(timer);
        resolve({ ok: false });
      });
  });
}
