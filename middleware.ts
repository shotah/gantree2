import { NextResponse } from "next/server";
import { guard } from "@/lib/door/http";
import { doorEnv, userStore } from "@/lib/door/runtime";

/** One door. Pages bounce to /login?next=, /api and /ws answer 401 JSON. */
export async function middleware(request: Request): Promise<Response> {
  return (await guard(request, doorEnv(), userStore())) ?? NextResponse.next();
}

export const config = {
  matcher: ["/((?!_vinext|_next|assets|favicon\\.ico|icon\\.svg|robots\\.txt|sw\\.js|manifest\\.webmanifest).*)"],
};
