import { fromDoor } from "@/lib/agents/http";
import { getTools } from "@/lib/agents/toolsHttp";
import { doorEnv } from "@/lib/door/runtime";

export function GET(request: Request): Response {
  return getTools(request, fromDoor(doorEnv()));
}
