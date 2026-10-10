export type WakeLockSentinel = {
  released?: boolean;
  release: () => Promise<void>;
};

export type WakeLockLike = {
  request: (type: "screen") => Promise<WakeLockSentinel>;
};

/** Screen wake while waiting for a reply. Missing API / denied → null. */
export async function requestScreenWake(api: WakeLockLike | null | undefined): Promise<WakeLockSentinel | null> {
  if (!api) {
    return null;
  }
  try {
    return await api.request("screen");
  } catch {
    return null;
  }
}

export async function releaseScreenWake(sentinel: WakeLockSentinel | null | undefined): Promise<null> {
  if (!sentinel || sentinel.released) {
    return null;
  }
  try {
    await sentinel.release();
  } catch {
    // already released
  }
  return null;
}
