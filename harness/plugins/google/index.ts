import type { Plugin, PluginContext, SkipReason, Tool } from "@/harness/core/tools";
import { authTools } from "@/harness/plugins/google/auth-tools";
import { calendarTools } from "@/harness/plugins/google/calendar";
import { chatTools } from "@/harness/plugins/google/chat";
import { contactsTools } from "@/harness/plugins/google/contacts";
import { docsTools } from "@/harness/plugins/google/docs";
import { driveTools } from "@/harness/plugins/google/drive";
import { formsTools } from "@/harness/plugins/google/forms";
import { gmailTools } from "@/harness/plugins/google/gmail";
import { pluralize } from "@/harness/plugins/google/plural";
import { applyPreset } from "@/harness/plugins/google/preset";
import { searchTools } from "@/harness/plugins/google/search";
import { sheetsTools } from "@/harness/plugins/google/sheets";
import { slidesTools } from "@/harness/plugins/google/slides";
import { tasksTools } from "@/harness/plugins/google/tasks";
import { CLIENT_ID_ENV, CLIENT_SECRET_ENV, LEGACY_PROVIDER, authFinish, authStart, workspaceEmails } from "@/harness/plugins/google/oauth";
export { keys } from "./keys";

/**
 * Google Workspace plugin. One OAuth token per mailbox (`google:<email>`).
 * Google Health keeps its own `google-health` token.
 */
export function googlePlugin(): Plugin {
  return {
    name: "google",
    ready,
    tools,
    authStart,
    authFinish,
  };
}

export const google = googlePlugin();

async function ready(ctx: PluginContext): Promise<SkipReason | null> {
  const id = ctx.env[CLIENT_ID_ENV] ?? "";
  const secret = ctx.env[CLIENT_SECRET_ENV] ?? "";
  if (!id || !secret) {
    return "no_key";
  }
  const emails = await workspaceEmails(ctx);
  if (emails.length > 0) {
    return null;
  }
  const legacy = await ctx.tokens.get(LEGACY_PROVIDER);
  if (legacy?.accessToken) {
    return null;
  }
  return "no_oauth";
}

function tools(ctx: PluginContext): Tool[] {
  const list = [
    ...gmailTools(ctx),
    ...calendarTools(ctx),
    ...chatTools(ctx),
    ...contactsTools(ctx),
    ...docsTools(ctx),
    ...driveTools(ctx),
    ...formsTools(ctx),
    ...searchTools(ctx),
    ...sheetsTools(ctx),
    ...slidesTools(ctx),
    ...tasksTools(ctx),
    ...authTools(ctx),
  ];
  list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return applyPreset(ctx, pluralize(list));
}
