import { roomsFor } from "@/lib/chat/membership";
import { me } from "@/lib/door/http";
import { doorEnv, userStore } from "@/lib/door/runtime";

export function GET(request: Request): Promise<Response> {
  const env = doorEnv();
  return me(request, env, userStore(), roomsFor(env));
}
