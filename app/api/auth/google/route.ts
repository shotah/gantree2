import { startGoogle } from "@/lib/door/http";
import { doorEnv, platformGoogle } from "@/lib/door/runtime";

export async function GET(request: Request): Promise<Response> {
  const google = await platformGoogle();
  return startGoogle(request, doorEnv(), google);
}
