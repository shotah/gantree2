import type { CallContext, PluginContext, ToolResult } from "@/harness/core/tools";
import { errorResult } from "@/harness/core/tools";
import { errorText } from "@/harness/plugins/google/args";
import type { GoogleClient } from "@/harness/plugins/google/http";
import { connect } from "@/harness/plugins/google/http";
import { EmailRequired, resolveEmail } from "@/harness/plugins/google/oauth";

export type GoogleSession = { email: string; api: GoogleClient };

/**
 * Resolve the account and an authenticated client.
 * `missingEmail` is the tool result when no address is available; `"message"`
 * returns the Go resolveEmail error text instead.
 */
export async function openUser(
  ctx: PluginContext,
  args: Record<string, unknown>,
  call: CallContext,
  missingEmail: ToolResult | "message",
): Promise<GoogleSession | ToolResult> {
  try {
    const email = await resolveEmail(ctx, args);
    const api = await connect(ctx, email, call.signal);
    return { email, api };
  } catch (e) {
    if (e instanceof EmailRequired) {
      return missingEmail === "message" ? errorResult(e.message) : missingEmail;
    }
    return errorResult(errorText(e));
  }
}

export function isResult(v: GoogleSession | ToolResult): v is ToolResult {
  return "content" in v;
}
