import { deleteAgent, fromDoor, getAgent } from "@/lib/agents/http";
import { doorEnv } from "@/lib/door/runtime";

export function GET(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  return context.params.then(({ slug }) => getAgent(request, fromDoor(doorEnv()), slug));
}

export function DELETE(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  return context.params.then(({ slug }) => deleteAgent(request, fromDoor(doorEnv()), slug));
}
