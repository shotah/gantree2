import { getContainer, postContainer } from "@/lib/agents/containerHttp";
import type { AgentsEnv } from "@/lib/agents/types";
import { doorEnv } from "@/lib/door/runtime";

type Ctx = { params: Promise<{ slug: string }> };

function env(): AgentsEnv {
  return doorEnv() as unknown as AgentsEnv;
}

export async function GET(request: Request, context: Ctx): Promise<Response> {
  const { slug } = await context.params;
  return getContainer(request, env(), slug);
}

export async function POST(request: Request, context: Ctx): Promise<Response> {
  const { slug } = await context.params;
  return postContainer(request, env(), slug);
}
