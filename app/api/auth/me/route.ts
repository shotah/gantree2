import { me } from "@/lib/door/http";
import { doorEnv, userStore } from "@/lib/door/runtime";

export function GET(request: Request): Promise<Response> {
  return me(request, doorEnv(), userStore());
}
