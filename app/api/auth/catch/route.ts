import { catchOAuth } from "@/harness/room/catch";
import { doorEnv, userStore } from "@/lib/door/runtime";

export function GET(request: Request): Promise<Response> {
  return catchOAuth(request, doorEnv(), userStore());
}
