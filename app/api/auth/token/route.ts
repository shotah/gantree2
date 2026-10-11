import { authToken } from "@/lib/door/native";
import { doorEnv, userStore } from "@/lib/door/runtime";

export function POST(request: Request): Promise<Response> {
  return authToken(request, doorEnv(), userStore());
}
