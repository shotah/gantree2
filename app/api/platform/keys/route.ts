import { getPlatformKeys, patchPlatformKeys } from "@/lib/door/platformKeysHttp";
import { doorEnv, userStore } from "@/lib/door/runtime";

export function GET(request: Request): Promise<Response> {
  return getPlatformKeys(request, doorEnv(), userStore());
}

export function PATCH(request: Request): Promise<Response> {
  return patchPlatformKeys(request, doorEnv(), userStore());
}
