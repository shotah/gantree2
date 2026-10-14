import { authConfig } from "@/lib/door/native";
import { doorEnv, platformGoogle } from "@/lib/door/runtime";

export async function GET(request: Request): Promise<Response> {
  const google = await platformGoogle();
  return authConfig(request, doorEnv(), google);
}
