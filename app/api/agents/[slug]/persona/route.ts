import { deleteAgentPersona, fromDoor, getAgentPersona, putAgentPersona } from "@/lib/agents/http";
import { doorEnv } from "@/lib/door/runtime";

export function GET(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  return context.params.then(({ slug }) => getAgentPersona(request, fromDoor(doorEnv()), slug));
}

export function PUT(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  return context.params.then(({ slug }) => putAgentPersona(request, fromDoor(doorEnv()), slug));
}

export function DELETE(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  return context.params.then(({ slug }) => deleteAgentPersona(request, fromDoor(doorEnv()), slug));
}
