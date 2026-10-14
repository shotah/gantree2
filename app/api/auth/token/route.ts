import { authToken } from "@/lib/door/native";
import { doorEnv, platformGoogle, userStore } from "@/lib/door/runtime";

export async function POST(request: Request): Promise<Response> {
  const google = await platformGoogle();
  return authToken(request, doorEnv(), userStore(), { google });
}
