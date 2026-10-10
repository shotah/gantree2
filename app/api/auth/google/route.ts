import { startGoogle } from "@/lib/door/http";
import { doorEnv } from "@/lib/door/runtime";

export function GET(request: Request): Promise<Response> {
  return startGoogle(request, doorEnv());
}
