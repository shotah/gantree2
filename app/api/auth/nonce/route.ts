import { authNonce } from "@/lib/door/native";
import { doorEnv } from "@/lib/door/runtime";

export function GET(): Promise<Response> {
  return authNonce(doorEnv());
}
