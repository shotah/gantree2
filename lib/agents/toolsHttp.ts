/**
 * GET /api/tools → `{ tools: ToolEntry[] }` for any signed-in principal.
 */
import { principalFromHeaders } from "@/lib/door/gate";
import { json } from "@/lib/door/http";
import { toolCatalog } from "./catalog";

export function getTools(request: Request): Response {
  if (!principalFromHeaders(request.headers)) {
    return json({ error: "unauthorized" }, 401);
  }
  return json({ tools: toolCatalog() });
}
