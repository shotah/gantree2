import { describe, expect, it } from "vitest";
import type { JsonSchema } from "@/brain/core/tools";
import { isRecord } from "@/brain/plugins/google/args";
import { catalogNames, toolDef } from "@/brain/plugins/google/catalog";
import { google } from "@/brain/plugins/google/index";
import { testCtx } from "@/test/brain/plugins/google/harness";

const fullPrefixes = ["auth_", "calendar_", "chat_", "contacts_", "forms_", "gmail_", "pse_", "slides_", "tasks_"];

const partial = [
  "docs_create",
  "docs_get_content",
  "docs_search",
  "docs_update_text",
  "drive_convert_to_doc",
  "drive_create_file",
  "drive_create_permission",
  "drive_get_file_content",
  "drive_get_file_download_url",
  "drive_get_shareable_link",
  "drive_search_files",
  "sheets_create_spreadsheet",
  "sheets_get_values",
  "sheets_list_spreadsheets",
  "sheets_update_values",
];

/** Production default (`GOOGLE_TOOL_PRESET` unset) matches the Go `--preset everyday` surface. */
const EVERYDAY = [
  "auth_list_accounts",
  "calendar_create_events",
  "calendar_delete_event",
  "calendar_get_event",
  "calendar_list_calendars",
  "calendar_list_events",
  "calendar_search_freebusy",
  "calendar_update_events",
  "contacts_create",
  "contacts_get",
  "contacts_list",
  "contacts_search",
  "docs_create",
  "docs_get_content",
  "docs_search",
  "docs_update_text",
  "drive_convert_to_doc",
  "drive_create_file",
  "drive_create_permission",
  "drive_get_file_content",
  "drive_get_file_download_url",
  "drive_get_shareable_link",
  "drive_search_files",
  "gmail_create_message",
  "gmail_get_message",
  "gmail_get_messages_batch",
  "gmail_search_messages",
  "gmail_update_message_labels",
  "sheets_create_spreadsheet",
  "sheets_get_values",
  "sheets_list_spreadsheets",
  "sheets_update_values",
  "tasks_create_task",
  "tasks_create_tasklist",
  "tasks_get_task",
  "tasks_list_tasklists",
  "tasks_list_tasks",
  "tasks_update_task",
];

const LEAN = [
  "auth_list_accounts",
  "calendar_create_events",
  "calendar_delete_event",
  "calendar_get_event",
  "calendar_list_calendars",
  "calendar_list_events",
  "calendar_search_freebusy",
  "calendar_update_events",
  "gmail_create_message",
  "gmail_get_message",
  "gmail_get_messages_batch",
  "gmail_search_messages",
  "gmail_update_message_labels",
];

const baseEnv = {
  GOOGLE_OAUTH_CLIENT_ID: "cid",
  GOOGLE_OAUTH_CLIENT_SECRET: "csecret",
  USER_GOOGLE_EMAIL: "test@example.com",
};

const published = [
  ...catalogNames().filter((name) => fullPrefixes.some((prefix) => name.startsWith(prefix))),
  ...partial,
].sort();

function schemaExtends(actual: JsonSchema, spec: JsonSchema): boolean {
  if (actual.type !== spec.type) {
    return false;
  }
  if (!isRecord(spec.properties) || !isRecord(actual.properties)) {
    return false;
  }
  for (const [key, value] of Object.entries(spec.properties)) {
    if (JSON.stringify(actual.properties[key]) !== JSON.stringify(value)) {
      return false;
    }
  }
  const required = Array.isArray(spec.required) ? spec.required : [];
  const actualRequired = Array.isArray(actual.required) ? actual.required : [];
  return required.every((name) => actualRequired.includes(name));
}

describe("published google tools", () => {
  it("preset all matches the Go tools/list name, description, and inputSchema", () => {
    const tools = google.tools(testCtx());
    expect(tools.map((t) => t.name)).toEqual(published);
    for (const tool of tools) {
      const spec = toolDef(tool.name);
      expect(tool.description).toBe(spec.description);
      expect(schemaExtends(tool.inputSchema, spec.inputSchema)).toBe(true);
    }
  });

  it("defaults to the everyday preset", () => {
    const tools = google.tools(testCtx({ env: baseEnv }));
    expect(tools.map((t) => t.name)).toEqual(EVERYDAY);
    expect(google.tools(testCtx({ env: { ...baseEnv, GOOGLE_TOOL_PRESET: "everyday" } })).map((t) => t.name)).toEqual(EVERYDAY);
    expect(google.tools(testCtx({ env: { ...baseEnv, GOOGLE_TOOL_PRESET: "nope" } })).map((t) => t.name)).toEqual(EVERYDAY);
  });

  it("lean is gmail, calendar, and auth_list_accounts", () => {
    const tools = google.tools(testCtx({ env: { ...baseEnv, GOOGLE_TOOL_PRESET: "lean" } }));
    expect(tools.map((t) => t.name)).toEqual(LEAN);
  });

  it("hides auth_generate_url when MCP_ENABLE_OAUTH21=true", () => {
    const hidden = google.tools(testCtx({ env: { ...baseEnv, GOOGLE_TOOL_PRESET: "all", MCP_ENABLE_OAUTH21: "TRUE" } }));
    expect(hidden.some((t) => t.name === "auth_generate_url")).toBe(false);
    expect(hidden.some((t) => t.name === "auth_list_accounts")).toBe(true);
  });
});
