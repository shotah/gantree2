import { fromDoor, getAgentConfig, patchAgentConfig } from "@/lib/agents/http";
import { doorEnv } from "@/lib/door/runtime";

export function GET(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  return context.params.then(({ slug }) => getAgentConfig(request, fromDoor(doorEnv()), slug));
}

export function PATCH(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  return context.params.then(({ slug }) => patchAgentConfig(request, fromDoor(doorEnv()), slug));
}
