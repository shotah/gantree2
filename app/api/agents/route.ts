import { fromDoor, getAgents, postAgent } from "@/lib/agents/http";
import { doorEnv } from "@/lib/door/runtime";

export function GET(request: Request): Promise<Response> {
  return getAgents(request, fromDoor(doorEnv()));
}

export function POST(request: Request): Promise<Response> {
  return postAgent(request, fromDoor(doorEnv()));
}
