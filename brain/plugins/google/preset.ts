import type { PluginContext, Tool } from "@/brain/core/tools";

/** Go `--preset` names, plus `all` for every tool this plugin has ported. */
export const PRESET_ENV = "GOOGLE_TOOL_PRESET";

const CORE: Record<string, readonly string[]> = {
  auth: ["auth_list_accounts"],
  gmail: [
    "gmail_search_messages",
    "gmail_get_message",
    "gmail_get_messages_batch",
    "gmail_create_message",
    "gmail_update_message_labels",
  ],
  calendar: [
    "calendar_list_calendars",
    "calendar_list_events",
    "calendar_get_event",
    "calendar_create_events",
    "calendar_update_events",
    "calendar_delete_event",
    "calendar_search_freebusy",
  ],
  docs: ["docs_get_content", "docs_create", "docs_update_text", "docs_search"],
  sheets: ["sheets_create_spreadsheet", "sheets_get_values", "sheets_update_values", "sheets_list_spreadsheets"],
  tasks: [
    "tasks_get_task",
    "tasks_list_tasks",
    "tasks_create_task",
    "tasks_update_task",
    "tasks_list_tasklists",
    "tasks_create_tasklist",
  ],
  contacts: ["contacts_search", "contacts_get", "contacts_list", "contacts_create"],
  drive: [
    "drive_search_files",
    "drive_get_file_content",
    "drive_get_file_download_url",
    "drive_create_file",
    "drive_convert_to_doc",
    "drive_create_permission",
    "drive_get_shareable_link",
  ],
};

const DESTRUCTIVE = new Set([
  "drive_update_ownership",
  "contacts_batch_delete",
  "tasks_delete_tasklist",
  "contacts_delete_group",
  "appscript_delete_project",
  "tasks_delete_completed",
]);

const LEAN = ["gmail", "calendar"];
const EVERYDAY = ["gmail", "calendar", "docs", "sheets", "tasks", "contacts", "drive"];

/**
 * Mirror `--preset`. Unset or unknown values use `everyday` (the host manifest).
 * `all` publishes every tool the plugin has implemented. `lean` and `everyday`
 * keep that preset's core tools and drop destructive ones (`capability=edit`).
 */
export function applyPreset(ctx: PluginContext, tools: Tool[]): Tool[] {
  const raw = (ctx.env[PRESET_ENV] ?? "").trim().toLowerCase();
  if (raw === "all") {
    return tools;
  }
  const services = raw === "lean" ? LEAN : EVERYDAY;
  const allowed = new Set<string>(CORE.auth);
  for (const service of services) {
    for (const name of CORE[service] ?? []) {
      allowed.add(name);
    }
  }
  return tools.filter((tool) => allowed.has(tool.name) && !DESTRUCTIVE.has(tool.name));
}
