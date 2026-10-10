import { doorEnv, userStore } from "@/lib/door/runtime";
import { handleTts, type TtsEnv } from "@/lib/tts/http";
import type { DoorEnv } from "@/lib/door/http";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return handleTts(request, doorEnv(), userStore());
}

export function POST(request: Request): Promise<Response> {
  return handleTts(request, doorEnv(), userStore());
}
