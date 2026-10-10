import { handleAvatar, type RoomEnv } from "@/lib/avatar/http";
import { doorEnv, userStore } from "@/lib/door/runtime";

export const dynamic = "force-dynamic";

function roomEnv(): RoomEnv {
  return doorEnv();
}

export function GET(request: Request): Promise<Response> {
  return handleAvatar(request, roomEnv(), userStore());
}

export function POST(request: Request): Promise<Response> {
  return handleAvatar(request, roomEnv(), userStore());
}
