import { authConfig } from "@/lib/door/native";
import { doorEnv } from "@/lib/door/runtime";

export function GET(request: Request): Response {
  return authConfig(request, doorEnv());
}
