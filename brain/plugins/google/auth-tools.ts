import type { CallContext, PluginContext, Tool, ToolResult } from "@/brain/core/tools";
import { errorResult, textResult } from "@/brain/core/tools";
import { errorText, requireString } from "@/brain/plugins/google/args";
import { toolDef } from "@/brain/plugins/google/catalog";
import {
  AuthFailed,
  DEFAULT_REDIRECT_URI,
  EmailRequired,
  REDIRECT_URI_ENV,
  buildAuthUrl,
  canonicalEmail,
  resolveEmail,
} from "@/brain/plugins/google/oauth";

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
  const tok = await ctx.tokens.get("google");
  const email = canonicalEmail(tok?.extra?.email ?? "");
  if (!email) {
    return textResult("No Google accounts are signed in. A person runs `google-mcp auth` once per account.");
  }
  return textResult(`Signed-in Google accounts (1):\n- ${email}\nPass one of these as user_google_email on later calls.`);
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
  msg += "Prefer first-time setup via CLI: `google-mcp auth` (or `google-mcp login`).\n\n";
  msg += `To proceed, the user must authorize this application for ${serviceName} access using all required permissions.\n`;
  msg += "**LLM, please present this exact authorization URL to the user as a clickable hyperlink:**\n";
  msg += `Authorization URL: ${authURL}\n`;
  msg += `Markdown for hyperlink: [Click here to authorize ${serviceName} access](${authURL})\n\n`;
  msg += "**LLM, after presenting the link, instruct the user as follows:**\n";
  msg += "1. Click the link and complete the authorization in their browser.\n";
  if (!initialEmailProvided) {
    msg += "2. After successful authorization, the browser page will display the authenticated email address.\n";
    msg += "   **LLM: Instruct the user to provide you with this email address.**\n";
    msg += "3. Once you have the email, **retry their original command, ensuring you include this `user_google_email`.**\n";
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
