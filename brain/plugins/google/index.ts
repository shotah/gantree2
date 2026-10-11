import type { Plugin, PluginContext, SkipReason, Tool } from "@/brain/core/tools";
import { authTools } from "@/brain/plugins/google/auth-tools";
import { calendarTools } from "@/brain/plugins/google/calendar";
import { chatTools } from "@/brain/plugins/google/chat";
import { contactsTools } from "@/brain/plugins/google/contacts";
import { docsTools } from "@/brain/plugins/google/docs";
import { driveTools } from "@/brain/plugins/google/drive";
import { formsTools } from "@/brain/plugins/google/forms";
import { gmailTools } from "@/brain/plugins/google/gmail";
import { pluralize } from "@/brain/plugins/google/plural";
import { applyPreset } from "@/brain/plugins/google/preset";
import { searchTools } from "@/brain/plugins/google/search";
import { sheetsTools } from "@/brain/plugins/google/sheets";
import { slidesTools } from "@/brain/plugins/google/slides";
import { tasksTools } from "@/brain/plugins/google/tasks";
import { CLIENT_ID_ENV, CLIENT_SECRET_ENV, authFinish, authStart } from "@/brain/plugins/google/oauth";

/**
 * Google Workspace plugin. Owns the shared `"google"` OAuth token
 * (gmail, calendar, and google-health all read it).
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
  const tok = await ctx.tokens.get("google");
  if (!tok) {
    return "no_oauth";
  }
  return null;
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
