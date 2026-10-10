import { NextResponse } from "next/server";
import { gate } from "@/lib/door/gate";
import { forwardHeaders, refusal } from "@/lib/door/http";
import { doorEnv, userStore } from "@/lib/door/runtime";

/**
 * One door. Pages bounce to /login?next=, /api and /ws answer 401 JSON. A pass
 * forwards the resolved principal as `x-gantree-*` request headers — and drops
 * any the client sent, since handlers trust those names.
 */
export async function middleware(request: Request): Promise<Response> {
  const decision = await gate(request, doorEnv(), userStore());
  const refused = refusal(decision, new URL(request.url));
  if (refused) {
    return refused;
  }
  return NextResponse.next({ request: { headers: forwardHeaders(decision, request.headers) } });
}

export const config = {
  matcher: ["/((?!_vinext|_next|assets|favicon\\.ico|icon\\.svg|robots\\.txt|sw\\.js|manifest\\.webmanifest).*)"],
};
