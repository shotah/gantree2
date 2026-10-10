import { fromDoor, handleSnapshot } from "@/lib/agents/http";
import { doorEnv } from "@/lib/door/runtime";

export function GET(request: Request, context: { params: Promise<{ slug: string; file: string }> }): Promise<Response> {
  return context.params.then(({ slug, file }) => handleSnapshot(request, fromDoor(doorEnv()), slug, file));
}

export function PUT(request: Request, context: { params: Promise<{ slug: string; file: string }> }): Promise<Response> {
  return context.params.then(({ slug, file }) => handleSnapshot(request, fromDoor(doorEnv()), slug, file));
}
