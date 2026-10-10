import { finishGoogle } from "@/lib/door/http";
import { doorEnv, userStore } from "@/lib/door/runtime";

export function GET(request: Request): Promise<Response> {
  return finishGoogle(request, doorEnv(), userStore());
}
