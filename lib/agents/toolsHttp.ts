/**
 * GET /api/tools → `{ tools: ToolEntry[], house: string[] }` for any signed-in
 * principal. `house` is the key names the Worker env supplies to every agent,
 * so the build wizard can leave those blank.
 */
import { principalFromHeaders } from "@/lib/door/gate";
import { json } from "@/lib/door/http";
import { toolCatalog } from "./catalog";
import { type HouseEnv, houseKeys } from "./house";

export function getTools(request: Request, env?: HouseEnv): Response {
  if (!principalFromHeaders(request.headers)) {
    return json({ error: "unauthorized" }, 401);
  }
  return json({ tools: toolCatalog(), house: houseKeys(env) });
}
