import { fromDoor, getSamples } from "@/lib/agents/http";
import { doorEnv } from "@/lib/door/runtime";

export function GET(request: Request): Promise<Response> {
  return getSamples(request, fromDoor(doorEnv()));
}
