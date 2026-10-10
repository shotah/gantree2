import { handlePush } from "@/app/lib/pushHttp";
import type { RoomEnv } from "@/lib/avatar/http";
import { doorEnv, userStore } from "@/lib/door/runtime";

export const dynamic = "force-dynamic";

type PushEnv = RoomEnv & {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};

export function GET(request: Request): Promise<Response> {
  return handlePush(request, doorEnv(), userStore());
}

export function PUT(request: Request): Promise<Response> {
  return handlePush(request, doorEnv(), userStore());
}

export function POST(request: Request): Promise<Response> {
  return handlePush(request, doorEnv(), userStore());
}

export function DELETE(request: Request): Promise<Response> {
  return handlePush(request, doorEnv(), userStore());
}
