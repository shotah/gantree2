import type { CallContext, PluginContext, Tool, ToolResult } from "@/harness/core/tools";
import { errorResult, textResult } from "@/harness/core/tools";
import { errorText, requireString } from "@/harness/plugins/google/args";
import { toolDef } from "@/harness/plugins/google/catalog";
import {
  AuthFailed,
  DEFAULT_REDIRECT_URI,
  EmailRequired,
  REDIRECT_URI_ENV,
  buildAuthUrl,
  resolveEmail,
  workspaceEmails,
} from "@/harness/plugins/google/oauth";

type Handler = (args: Record<string, unknown>, call: CallContext) => Promise<ToolResult>;

export function authTools(ctx: PluginContext): Tool[] {
  const bind = (name: string, fn: Handler): Tool => ({ ...toolDef(name), call: fn });
  const tools = [bind("auth_list_accounts", (args, call) => listAccounts(ctx, args, call))];
  if ((ctx.env.MCP_ENABLE_OAUTH21 ?? "").toLowerCase() !== "true") {
    tools.push(bind("auth_generate_url", (args, call) => generateUrl(ctx, args, call)));
  }
  return tools;
}

async function listAccounts(ctx: PluginContext, _args: Record<string, unknown>, _call: CallContext): Promise<ToolResult> {
  const emails = await workspaceEmails(ctx);
  if (emails.length === 0) {
    return textResult(
      "No Google accounts are signed in. A person must connect Google for this agent. "
      + "If they use more than one mailbox (work, personal, or another), ask which address to use as user_google_email before calling Google tools.",
    );
  }
  const lines = emails.map((email) => `- ${email}`).join("\n");
  return textResult(`Signed-in Google accounts (${emails.length}):\n${lines}\nPass one of these as user_google_email on later calls.`);
}

async function generateUrl(ctx: PluginContext, args: Record<string, unknown>, _call: CallContext): Promise<ToolResult> {
  const serviceName = requireString(args, "service_name");
  if (serviceName === undefined) {
    return errorResult("service_name is required");
  }
  let email: string;
  try {
    email = await resolveEmail(ctx, args);
  } catch (e) {
    if (e instanceof EmailRequired) {
      return errorResult(e.message);
    }
    return errorResult(errorText(e));
  }
  const redirect = ctx.env[REDIRECT_URI_ENV] || DEFAULT_REDIRECT_URI;
  const state = randomHex(16);
  try {
    const url = await buildAuthUrl(ctx, redirect, state);
    return textResult(authStartMessage(serviceName, email, url));
  } catch (e) {
    const msg = e instanceof AuthFailed || e instanceof Error ? e.message : "auth failed";
    return errorResult(`**Authentication Error:** ${msg}`);
  }
}

function authStartMessage(serviceName: string, userEmail: string, authURL: string): string {
  const initialEmailProvided = userEmail.trim() !== "" && userEmail.toLowerCase() !== "default";
  const userDisplayName = initialEmailProvided ? `${serviceName} for '${userEmail}'` : serviceName;
  let msg = `**ACTION REQUIRED: Google Authentication Needed for ${userDisplayName}**\n\n`;
  msg += `To proceed, the user must authorize this application for ${serviceName} access using all required permissions.\n`;
  msg += "**LLM, please present this exact authorization URL to the user as a clickable hyperlink:**\n";
  msg += `Authorization URL: ${authURL}\n`;
  msg += `Markdown for hyperlink: [Click here to authorize ${serviceName} access](${authURL})\n\n`;
  msg += "**LLM, after presenting the link, instruct the user as follows:**\n";
  msg += "1. Click the link and complete the authorization in their browser.\n";
  if (!initialEmailProvided) {
    msg += "2. After successful authorization, the browser page will display the authenticated email address.\n";
    msg += "   **LLM: Ask which Google account they authorized — work, personal, or another mailbox — and have them confirm that address.**\n";
    msg += "3. Once you know the address, **retry their original command, ensuring you include it as `user_google_email`.** Do not guess.\n";
  } else {
    msg += "2. After successful authorization, **retry their original command**.\n";
  }
  msg += `\nThe application will use the new credentials. If '${userEmail}' was provided, it must match the authenticated account.`;
  return msg;
}

function randomHex(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
