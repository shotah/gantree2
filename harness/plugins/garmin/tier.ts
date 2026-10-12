export type ToolTier = "core" | "extended" | "complete";

/** `--tool-tier` as env. Empty or unknown stays core (the host-manifest default). */
export function toolTier(env: Readonly<Record<string, string>>): ToolTier {
  const raw = (env.GARMIN_TOOL_TIER ?? "").trim().toLowerCase();
  if (raw === "extended" || raw === "complete") return raw;
  return "core";
}

/** Extended and complete both include the extended tool set. */
export function publishesExtended(env: Readonly<Record<string, string>>): boolean {
  return toolTier(env) !== "core";
}
