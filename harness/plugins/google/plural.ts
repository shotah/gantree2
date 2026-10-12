import type { CallContext, JsonSchema, Tool, ToolResult } from "@/harness/core/tools";
import { errorResult, jsonResult } from "@/harness/core/tools";
import { getStringSlice, isRecord } from "@/harness/plugins/google/args";

/** Ids fetched in one getter call. */
export const ID_CAP = 20;

const stringItems = { type: "string" };

function strings(description: string): JsonSchema {
  return { type: "array", description, items: stringItems };
}

function textProp(description: string): JsonSchema {
  return { type: "string", description };
}

function numberProp(description: string): JsonSchema {
  return { type: "number", description };
}

type IdSpec = { kind: "ids"; single: string; list: string };
type QuerySpec = { kind: "queries"; single: string };
type PairSpec = { kind: "pairs"; list: string; a: string; b: string };
type PropSpec = { kind: "props"; props: Record<string, JsonSchema> };
type SingleSpec = { kind: "single"; why: string };
type Spec = IdSpec | QuerySpec | PairSpec | PropSpec | SingleSpec;

const idList = (list: string, single: string): JsonSchema => strings(
  `${list} to fetch together (max ${ID_CAP}). ${single} is still accepted. `
  + "Returns a JSON array; a per-item failure is {id, error}.",
);

const queriesProp = strings(
  `Queries to run together (max ${ID_CAP}). The single query argument is still accepted. `
  + "Returns a JSON array of rows.",
);

const nameProps = (): Record<string, JsonSchema> => ({
  limit: numberProp("Max matches to return (default 50, max 200)."),
  name_contains: textProp(
    "Substring for Drive `name contains`. Returns every match up to limit as a JSON array of {id, name}.",
  ),
  name_prefix: textProp(
    "Name prefix. Drive query is `name contains`, then names that start with this prefix are kept. "
    + "Returns a JSON array of {id, name} up to limit (default 50).",
  ),
  name_prefixes: strings(
    `Prefixes to match in one call (max ${ID_CAP}). name_prefix is still accepted. Same prefix rule and JSON array.`,
  ),
});

const one = (what: string): SingleSpec => ({ kind: "single", why: what });

const SPECS: Record<string, Spec> = {
  auth_generate_url: one("one OAuth consent URL"),
  auth_list_accounts: one("one signed-in Google account"),
  calendar_delete_event: one("one event; calendar_list_events reads a range"),
  calendar_get_event: { kind: "ids", list: "event_ids", single: "event_id" },
  calendar_list_calendars: { kind: "props", props: { ids: strings(`Calendar ids to keep (max ${ID_CAP}). Omit to list calendars. Returns a JSON array when set.`) } },
  calendar_list_events: {
    kind: "props",
    props: {
      days: numberProp(
        "Window length in days when time_max is omitted. Default 7 when time_min is also omitted (max 31). "
        + "An explicit time_min without time_max or days stays a 24h window.",
      ),
    },
  },
  chat_create_message: one("one Chat message"),
  chat_list_messages: { kind: "ids", list: "space_ids", single: "space_id" },
  chat_list_spaces: { kind: "props", props: { ids: strings(`Space resource names to keep (max ${ID_CAP}). Omit to list spaces. Returns a JSON array when set.`) } },
  chat_search_messages: { kind: "queries", single: "query" },
  contacts_create: one("one contact; contacts_batch_create writes many"),
  contacts_create_group: one("one contact group"),
  contacts_delete: one("one contact; contacts_batch_delete deletes many"),
  contacts_delete_group: one("one contact group"),
  contacts_get: { kind: "ids", list: "contact_ids", single: "contact_id" },
  contacts_get_group: { kind: "ids", list: "group_ids", single: "group_id" },
  contacts_list: { kind: "props", props: { ids: strings(`Contact ids to keep (max ${ID_CAP}). Omit to list contacts. Returns a JSON array when set.`) } },
  contacts_list_groups: { kind: "props", props: { ids: strings(`Group ids to keep (max ${ID_CAP}). Omit to list groups. Returns a JSON array when set.`) } },
  contacts_search: { kind: "queries", single: "query" },
  contacts_update: one("one contact; contacts_batch_update writes many"),
  contacts_update_group: one("one contact group"),
  docs_create: one("one document"),
  docs_get_content: { kind: "ids", list: "document_ids", single: "document_id" },
  docs_search: { kind: "props", props: nameProps() },
  docs_update_text: one("one document text edit"),
  drive_convert_to_doc: one("one imported document"),
  drive_create_file: one("one Drive file"),
  drive_create_permission: one("one permission; drive batch share is a separate tool"),
  drive_get_file_content: { kind: "ids", list: "file_ids", single: "file_id" },
  drive_get_file_download_url: { kind: "ids", list: "file_ids", single: "file_id" },
  drive_get_shareable_link: { kind: "ids", list: "file_ids", single: "file_id" },
  drive_search_files: { kind: "props", props: nameProps() },
  forms_create: one("one form"),
  forms_get: { kind: "ids", list: "form_ids", single: "form_id" },
  forms_get_response: { kind: "ids", list: "response_ids", single: "response_id" },
  forms_list_responses: { kind: "ids", list: "form_ids", single: "form_id" },
  forms_update_publish_settings: one("one form's publish settings"),
  gmail_create_draft: one("one draft"),
  gmail_create_filter: one("one filter"),
  gmail_create_message: one("one message"),
  gmail_delete_filter: one("one filter"),
  gmail_get_attachment: { kind: "pairs", a: "message_id", b: "attachment_id", list: "attachments" },
  gmail_get_message: { kind: "ids", list: "message_ids", single: "message_id" },
  gmail_get_thread: { kind: "ids", list: "thread_ids", single: "thread_id" },
  gmail_list_filters: { kind: "props", props: { ids: strings(`Filter ids to keep (max ${ID_CAP}). Omit to list filters. Returns a JSON array when set.`) } },
  gmail_list_labels: { kind: "props", props: { ids: strings(`Label ids to keep (max ${ID_CAP}). Omit to list labels. Returns a JSON array when set.`) } },
  gmail_search_messages: { kind: "queries", single: "query" },
  gmail_update_label: one("one label"),
  gmail_update_message_labels: one("one message; gmail_batch_update_message_labels covers many"),
  pse_get_engine_info: one("one Programmable Search engine"),
  pse_search: { kind: "queries", single: "q" },
  sheets_create_spreadsheet: one("one spreadsheet"),
  sheets_get_values: { kind: "ids", list: "spreadsheet_ids", single: "spreadsheet_id" },
  sheets_list_spreadsheets: { kind: "props", props: nameProps() },
  slides_create_comment: one("one comment"),
  slides_create_presentation: one("one presentation"),
  slides_create_reply: one("one comment reply"),
  slides_get_page: { kind: "ids", list: "page_object_ids", single: "page_object_id" },
  slides_get_page_thumbnail: { kind: "ids", list: "page_object_ids", single: "page_object_id" },
  slides_get_presentation: { kind: "ids", list: "presentation_ids", single: "presentation_id" },
  slides_list_comments: { kind: "ids", list: "presentation_ids", single: "presentation_id" },
  slides_resolve_comment: one("one comment resolve"),
  tasks_create_task: one("one task"),
  tasks_create_tasklist: one("one task list"),
  tasks_delete_completed: one("one task list's completed tasks"),
  tasks_delete_task: one("one task"),
  tasks_delete_tasklist: one("one task list"),
  tasks_get_task: { kind: "ids", list: "task_ids", single: "task_id" },
  tasks_get_tasklist: { kind: "ids", list: "task_list_ids", single: "task_list_id" },
  tasks_list_tasklists: { kind: "props", props: { ids: strings(`Task list ids to keep (max ${ID_CAP}). Omit to list task lists. Returns a JSON array when set.`) } },
  tasks_list_tasks: { kind: "ids", list: "task_list_ids", single: "task_list_id" },
  tasks_update_task: one("one task"),
  tasks_update_task_position: one("one task move"),
  tasks_update_tasklist: one("one task list"),
};

/** Ids the caller asked to keep. Undefined when the argument is omitted or empty. */
export function onlyIds(args: Record<string, unknown>, key = "ids"): Set<string> | undefined {
  const list = getStringSlice(args, key);
  if (!list || list.length === 0) {
    return undefined;
  }
  return new Set(list.slice(0, ID_CAP));
}

/**
 * Extend published tools so each one takes a list or range, or is marked `single`.
 * Getters fan out and return a JSON array. The single id argument still works.
 */
export function pluralize(tools: Tool[]): Tool[] {
  return tools.map(applySpec);
}

function applySpec(tool: Tool): Tool {
  const spec = SPECS[tool.name];
  if (!spec) {
    return tool;
  }
  if (spec.kind === "single") {
    return { ...tool, single: spec.why };
  }
  const extra = extraProps(spec);
  const properties = {
    ...(isRecord(tool.inputSchema.properties) ? tool.inputSchema.properties : {}),
    ...extra,
  };
  const next: Tool = { ...tool, inputSchema: { ...tool.inputSchema, properties } };
  if (spec.kind === "props") {
    return next;
  }
  const original = (args: Record<string, unknown>, ctx: CallContext): Promise<ToolResult> => tool.call(args, ctx);
  return { ...next, call: (args, ctx) => fanOut(original, spec, args, ctx) };
}

function extraProps(spec: Spec): Record<string, JsonSchema> {
  if (spec.kind === "ids") {
    return { [spec.list]: idList(spec.list, spec.single) };
  }
  if (spec.kind === "queries") {
    return { queries: queriesProp };
  }
  if (spec.kind === "pairs") {
    return {
      attachments: {
        type: "array",
        description: `Attachments to download together (max ${ID_CAP}), each {message_id, attachment_id}. `
          + "message_id and attachment_id are still accepted. Returns a JSON array.",
        items: { type: "object" },
      },
    };
  }
  if (spec.kind === "props") {
    return spec.props;
  }
  return {};
}

async function fanOut(
  original: (args: Record<string, unknown>, ctx: CallContext) => Promise<ToolResult>,
  spec: IdSpec | QuerySpec | PairSpec,
  args: Record<string, unknown>,
  ctx: CallContext,
): Promise<ToolResult> {
  if (spec.kind === "pairs") {
    return fanPairs(original, spec, args, ctx);
  }
  if (spec.kind === "queries") {
    return fanQueries(original, spec, args, ctx);
  }
  return fanIds(original, spec, args, ctx);
}

async function fanIds(
  original: (args: Record<string, unknown>, ctx: CallContext) => Promise<ToolResult>,
  spec: IdSpec,
  args: Record<string, unknown>,
  ctx: CallContext,
): Promise<ToolResult> {
  const listed = unique([...(getStringSlice(args, spec.list) ?? []), ...(getStringSlice(args, "ids") ?? [])]);
  const one = strAt(args, spec.single);
  const ids = unique(one ? [one, ...listed] : listed);
  if (ids.length === 0) {
    return original(args, ctx);
  }
  if (ids.length > ID_CAP) {
    return errorResult(`${spec.list} accepts at most ${ID_CAP} ids`);
  }
  if (listed.length === 0) {
    const result = await original(args, ctx);
    if (result.isError) {
      return result;
    }
    return jsonResult([{ id: ids[0], text: resultText(result) }]);
  }
  const rows: { id: string; text?: string; error?: string }[] = [];
  for (const id of ids) {
    const next: Record<string, unknown> = { ...args, [spec.single]: id };
    delete next[spec.list];
    delete next.ids;
    const result = await original(next, ctx);
    const text = resultText(result);
    if (result.isError && isAuthFailure(text)) {
      return result;
    }
    rows.push(result.isError ? { id, error: text } : { id, text });
  }
  return jsonResult(rows);
}

async function fanQueries(
  original: (args: Record<string, unknown>, ctx: CallContext) => Promise<ToolResult>,
  spec: QuerySpec,
  args: Record<string, unknown>,
  ctx: CallContext,
): Promise<ToolResult> {
  const listed = unique(getStringSlice(args, "queries") ?? []);
  if (listed.length === 0) {
    return original(args, ctx);
  }
  if (listed.length > ID_CAP) {
    return errorResult(`queries accepts at most ${ID_CAP} queries`);
  }
  const one = strAt(args, spec.single);
  const queries = unique(one ? [one, ...listed] : listed);
  const rows: { id: string; text?: string; error?: string }[] = [];
  for (const query of queries) {
    const next: Record<string, unknown> = { ...args, [spec.single]: query };
    delete next.queries;
    const result = await original(next, ctx);
    const text = resultText(result);
    if (result.isError && isAuthFailure(text)) {
      return result;
    }
    rows.push(result.isError ? { id: query, error: text } : { id: query, text });
  }
  return jsonResult(rows);
}

type Pair = { a: string; b: string };

async function fanPairs(
  original: (args: Record<string, unknown>, ctx: CallContext) => Promise<ToolResult>,
  spec: PairSpec,
  args: Record<string, unknown>,
  ctx: CallContext,
): Promise<ToolResult> {
  const pairs: Pair[] = [];
  const a = strAt(args, spec.a);
  const b = strAt(args, spec.b);
  if (a && b) {
    pairs.push({ a, b });
  }
  const raw = args[spec.list];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!isRecord(item)) {
        continue;
      }
      const ia = strAt(item, spec.a);
      const ib = strAt(item, spec.b);
      if (ia && ib) {
        pairs.push({ a: ia, b: ib });
      }
    }
  }
  const uniquePairs = dedupePairs(pairs);
  if (uniquePairs.length === 0) {
    return original(args, ctx);
  }
  if (uniquePairs.length > ID_CAP) {
    return errorResult(`${spec.list} accepts at most ${ID_CAP} attachments`);
  }
  const listed = Array.isArray(raw) && raw.length > 0;
  if (!listed) {
    const result = await original(args, ctx);
    if (result.isError) {
      return result;
    }
    return jsonResult([{ id: `${a}/${b}`, text: resultText(result) }]);
  }
  const rows: { id: string; text?: string; error?: string }[] = [];
  for (const pair of uniquePairs) {
    const next: Record<string, unknown> = { ...args, [spec.a]: pair.a, [spec.b]: pair.b };
    delete next[spec.list];
    const result = await original(next, ctx);
    const text = resultText(result);
    if (result.isError && isAuthFailure(text)) {
      return result;
    }
    const id = `${pair.a}/${pair.b}`;
    rows.push(result.isError ? { id, error: text } : { id, text });
  }
  return jsonResult(rows);
}

function dedupePairs(pairs: Pair[]): Pair[] {
  const seen = new Set<string>();
  const out: Pair[] = [];
  for (const pair of pairs) {
    const key = `${pair.a}\n${pair.b}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(pair);
  }
  return out;
}

function strAt(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !out.includes(trimmed)) {
      out.push(trimmed);
    }
  }
  return out;
}

function resultText(result: ToolResult): string {
  const first = result.content[0];
  return first && first.type === "text" ? first.text : "";
}

function isAuthFailure(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("user_google_email")
    || lower.includes("authenticating for")
    || lower.includes("no credentials")
    || lower.includes("authentication failed");
}
