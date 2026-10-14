import { finishGoogle } from "@/lib/door/http";
import { doorEnv, platformGoogle, userStore } from "@/lib/door/runtime";

export async function GET(request: Request): Promise<Response> {
  const google = await platformGoogle();
  return finishGoogle(request, doorEnv(), userStore(), { google });
}
