import { ID_CAP } from "./schema";
import { GarminError } from "./json";

export function optionalString(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  return typeof v === "string" ? v : "";
}

/** Optional int the way MCP RequireFloat + HandlerArgs.Int does: bad types are ignored. */
export function optionalInt(args: Record<string, unknown>, name: string): number | undefined {
  const v = args[name];
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return undefined;
}

export function requireInt(args: Record<string, unknown>, name: string): number {
  if (!Object.prototype.hasOwnProperty.call(args, name) || args[name] == null || args[name] === "") {
    throw new GarminError(`missing required parameter: ${name}`);
  }
  const n = optionalInt(args, name);
  if (n === undefined) throw new GarminError(`missing required parameter: ${name}`);
  return n;
}

/** `activity_id` and/or `ids`. Missing both keeps the Go missing-parameter error. */
export function resolveActivityIds(args: Record<string, unknown>): number[] {
  const hasId = Object.prototype.hasOwnProperty.call(args, "activity_id") && args.activity_id != null && args.activity_id !== "";
  const hasIds = Object.prototype.hasOwnProperty.call(args, "ids") && args.ids != null;
  if (!hasId && !hasIds) throw new GarminError("missing required parameter: activity_id");
  const ids: number[] = [];
  if (hasId) ids.push(requireInt(args, "activity_id"));
  if (hasIds) {
    const raw = args.ids;
    if (!Array.isArray(raw)) throw new GarminError("ids must be a list of activity ids");
    for (const item of raw) {
      if (typeof item === "number" && Number.isFinite(item)) ids.push(Math.trunc(item));
      else if (typeof item === "string" && item.trim() !== "") {
        const n = Number(item);
        if (!Number.isFinite(n)) throw new GarminError("ids must be a list of activity ids");
        ids.push(Math.trunc(n));
      } else throw new GarminError("ids must be a list of activity ids");
    }
  }
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  if (unique.length === 0) throw new GarminError("missing required parameter: activity_id");
  if (unique.length > ID_CAP) throw new GarminError(`ids accepts at most ${ID_CAP} activities`);
  return unique;
}
