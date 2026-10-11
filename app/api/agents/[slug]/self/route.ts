import { fromDoor, getAgentSelf, putAgentSelf } from "@/lib/agents/http";
import { doorEnv } from "@/lib/door/runtime";

export function GET(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  return context.params.then(({ slug }) => getAgentSelf(request, fromDoor(doorEnv()), slug));
}

export function PUT(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  return context.params.then(({ slug }) => putAgentSelf(request, fromDoor(doorEnv()), slug));
}
