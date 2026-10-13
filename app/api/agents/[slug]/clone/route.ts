import { fromDoor, postAgentClone } from "@/lib/agents/http";
import { doorEnv } from "@/lib/door/runtime";

export function POST(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  return context.params.then(({ slug }) => postAgentClone(request, fromDoor(doorEnv()), slug));
}
