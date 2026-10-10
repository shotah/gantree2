import { handlePush } from "@/app/lib/pushHttp";
import { doorEnv, userStore } from "@/lib/door/runtime";

export const dynamic = "force-dynamic";

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
