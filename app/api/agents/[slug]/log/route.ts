import { fromDoor, getAgentLog } from "@/lib/agents/http";
import { doorEnv } from "@/lib/door/runtime";

export function GET(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  return context.params.then(({ slug }) => getAgentLog(request, fromDoor(doorEnv()), slug));
}
