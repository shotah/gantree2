const LOCATION_HINTS = [
  "wnam",
  "enam",
  "sam",
  "weur",
  "eeur",
  "apac",
  "oc",
  "afr",
  "me",
  "apac-ne",
  "apac-se",
] as const;

export type LocationHint = (typeof LOCATION_HINTS)[number];

const HINTS = new Set<string>(LOCATION_HINTS);

/** Best-effort colo hint for `DurableObjectNamespace.get`. Junk is ignored. */
export function parseLocationHint(raw: string | undefined | null): LocationHint | undefined {
  const v = raw?.trim().toLowerCase() ?? "";
  if (!HINTS.has(v)) {
    return undefined;
  }
  return v as LocationHint;
}

export type AgentBinding = {
  AGENT?: DurableObjectNamespace;
  LOCATION_HINT?: string;
};

/** Same stub everywhere so the first `get()` can pin the room near the Mini. */
export function agentStub(env: AgentBinding, slug: string): DurableObjectStub | null {
  if (!env.AGENT) {
    return null;
  }
  const id = env.AGENT.idFromName(slug);
  const hint = parseLocationHint(env.LOCATION_HINT);
  if (!hint) {
    return env.AGENT.get(id);
  }
  return env.AGENT.get(id, { locationHint: hint });
}
