import { handleTheme } from "@/app/lib/themeHttp";
import type { RoomEnv } from "@/lib/avatar/http";
import { doorEnv, userStore } from "@/lib/door/runtime";

export const dynamic = "force-dynamic";

function roomEnv(): RoomEnv {
  return doorEnv();
}

export function GET(request: Request): Promise<Response> {
  return handleTheme(request, roomEnv(), userStore());
}

export function POST(request: Request): Promise<Response> {
  return handleTheme(request, roomEnv(), userStore());
}

export function DELETE(request: Request): Promise<Response> {
  return handleTheme(request, roomEnv(), userStore());
}
