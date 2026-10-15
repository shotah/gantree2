/** JSON bundle for on-prem Agent DO SQLite → cloud agent migrate. */

export const ONPREM_BUNDLE_VERSION = 1 as const;

export type MemoryRow = {
  id: number;
  kind: string;
  subject: string;
  content: string;
  source: string;
  confidence: number;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  superseded_by: number | null;
  consolidated: number;
  consolidate_attempts: number;
};

export type AimEventRow = {
  id: number;
  day: string;
  what: string;
  ref: string;
  metric: string;
  value: number | null;
  unit: string;
  source: string;
  created_at: string;
  superseded_by: number | null;
};

export type AimScoreRow = {
  event_id: number;
  area: string;
  score: number;
  note: string;
};

export type AimBlockRow = {
  area: string;
  from_day: string;
  to_day: string;
};

export type PersonaFileRow = {
  name: string;
  text: string;
  updated_at: number;
};

export type SelfnoteRow = {
  id: string;
  body: string;
  updated_at: number;
};

export type OnPremBundle = {
  version: typeof ONPREM_BUNDLE_VERSION;
  memory: { rows: MemoryRow[] };
  aim_event: { rows: AimEventRow[] };
  aim_score: { rows: AimScoreRow[] };
  aim_block: { rows: AimBlockRow[] };
  persona_file: { rows: PersonaFileRow[] };
  selfnote: { rows: SelfnoteRow[] };
};

export const EXPORT_TABLE_NAMES = [
  "memory",
  "aim_event",
  "aim_score",
  "aim_block",
  "persona_file",
  "selfnote",
] as const;

export type ExportTableName = (typeof EXPORT_TABLE_NAMES)[number];

/** Tables that must never appear in an export bundle. */
export const FORBIDDEN_EXPORT_TABLES = [
  "oauth_token",
  "garmin_mfa_pending",
  "google_oauth_pending",
  "strava_oauth_pending",
  "session_message",
  "session",
] as const;

export function emptyBundle(): OnPremBundle {
  return {
    version: ONPREM_BUNDLE_VERSION,
    memory: { rows: [] },
    aim_event: { rows: [] },
    aim_score: { rows: [] },
    aim_block: { rows: [] },
    persona_file: { rows: [] },
    selfnote: { rows: [] },
  };
}

export function isOnPremBundle(raw: unknown): raw is OnPremBundle {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return false;
  }
  const v = (raw as { version?: unknown }).version;
  if (v !== ONPREM_BUNDLE_VERSION) {
    return false;
  }
  return true;
}

/** Fetch-like client for Agent DO internal URLs (`https://agent/...`). */
export type AgentDoFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

async function throwUnlessOk(res: Response, step: string): Promise<void> {
  if (res.ok) {
    return;
  }
  let detail = String(res.status);
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      detail += ` ${body.error}`;
    }
  } catch {
    /* plain-text or empty body */
  }
  throw new Error(`${step} → ${detail}`);
}

/** Push export JSON into an agent via DO ops (memory_import, aims_import, persona_put, self_put). */
export async function applyOnPremBundle(bundle: OnPremBundle, fetchAgent: AgentDoFetch): Promise<void> {
  const memImportRes = await fetchAgent("https://agent/memory", {
    method: "POST",
    headers: { "X-Chat-Op": "memory_import", "content-type": "application/json" },
    body: JSON.stringify(bundle.memory),
  });
  await throwUnlessOk(memImportRes, "memory_import");

  const aimsImportRes = await fetchAgent("https://agent/aims", {
    method: "POST",
    headers: { "X-Chat-Op": "aims_import", "content-type": "application/json" },
    body: JSON.stringify({
      aim_event: bundle.aim_event,
      aim_score: bundle.aim_score,
      aim_block: bundle.aim_block,
    }),
  });
  await throwUnlessOk(aimsImportRes, "aims_import");

  for (const file of bundle.persona_file.rows) {
    const personaRes = await fetchAgent("https://agent/persona", {
      method: "PUT",
      headers: { "X-Chat-Op": "persona_put", "content-type": "application/json" },
      body: JSON.stringify({ name: file.name, text: file.text }),
    });
    await throwUnlessOk(personaRes, "persona_put");
  }

  const selfRow = bundle.selfnote.rows.find((r) => r.id === "self") ?? bundle.selfnote.rows[0];
  if (selfRow && selfRow.body.trim() !== "") {
    const selfRes = await fetchAgent("https://agent/self", {
      method: "PUT",
      headers: { "X-Chat-Op": "self_put", "content-type": "application/json" },
      body: JSON.stringify({ text: selfRow.body }),
    });
    await throwUnlessOk(selfRes, "self_put");
  }
}

/** Row counts safe to log (no content). */
export function onPremBundleCounts(bundle: OnPremBundle): {
  memory: number;
  aim_event: number;
  aim_score: number;
  aim_block: number;
  persona_file: number;
  selfnote: number;
} {
  const selfRow = bundle.selfnote.rows.find((r) => r.id === "self") ?? bundle.selfnote.rows[0];
  const selfCount = selfRow && selfRow.body.trim() !== "" ? 1 : 0;
  return {
    memory: bundle.memory.rows.length,
    aim_event: bundle.aim_event.rows.length,
    aim_score: bundle.aim_score.rows.length,
    aim_block: bundle.aim_block.rows.length,
    persona_file: bundle.persona_file.rows.length,
    selfnote: selfCount,
  };
}
