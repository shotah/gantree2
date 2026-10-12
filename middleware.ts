import { NextResponse } from "next/server";
import { adminConsoleRefusal, gate } from "@/lib/door/gate";
import { forwardHeaders, refusal } from "@/lib/door/http";
import { doorEnv, userStore } from "@/lib/door/runtime";

/**
 * One door. Pages bounce to /login?next=, /api and /ws answer 401 JSON. A pass
 * forwards the resolved principal as `x-gantree-*` request headers — and drops
 * any the client sent, since handlers trust those names.
 */
export async function middleware(request: Request): Promise<Response> {
  const decision = await gate(request, doorEnv(), userStore());
  const url = new URL(request.url);
  const refused = refusal(decision, url);
  if (refused) {
    return refused;
  }
  if (decision.kind === "pass") {
    const consoleRefused = adminConsoleRefusal(decision.who, url, request.method);
    if (consoleRefused) {
      return consoleRefused;
    }
  }
  return NextResponse.next({ request: { headers: forwardHeaders(decision, request.headers) } });
}

export const config = {
  matcher: ["/((?!_vinext|_next|assets|favicon\\.ico|icon\\.svg|robots\\.txt|sw\\.js|manifest\\.webmanifest).*)"],
};
