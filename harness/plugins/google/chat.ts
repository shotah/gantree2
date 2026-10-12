import type { CallContext, PluginContext, Tool, ToolResult } from "@/harness/core/tools";
import { errorResult, jsonResult, textResult } from "@/harness/core/tools";
import { arrField, errorText, getInt, getString, isRecord, needArg, requireString, strField, toolHint } from "@/harness/plugins/google/args";
import { toolDef } from "@/harness/plugins/google/catalog";
import { onlyIds } from "@/harness/plugins/google/plural";
import { isResult, openUser } from "@/harness/plugins/google/session";

const CHAT = "https://chat.googleapis.com/v1";

type Handler = (args: Record<string, unknown>, call: CallContext) => Promise<ToolResult>;

export function chatTools(ctx: PluginContext): Tool[] {
  const bind = (name: string, fn: Handler): Tool => ({ ...toolDef(name), call: fn });
  return [
    bind("chat_list_spaces", (args, call) => listSpaces(ctx, args, call)),
    bind("chat_list_messages", (args, call) => listMessages(ctx, args, call)),
    bind("chat_create_message", (args, call) => createMessage(ctx, args, call)),
    bind("chat_search_messages", (args, call) => searchMessages(ctx, args, call)),
  ];
}

/** Bare ids become spaces/…. Nested resource names are left unchanged. */
export function normalizeChatSpaceID(spaceID: string): string {
  const id = spaceID.trim();
  if (id === "" || id.startsWith("spaces/") || id.includes("/")) {
    return id;
  }
  return `spaces/${id}`;
}

async function listSpaces(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "chat_list_spaces()"));
  if (isResult(opened)) {
    return opened;
  }
  const pageSize = getInt(args, "page_size", 100);
  const spaceType = getString(args, "space_type", "all");
  const query: Record<string, string | number> = { pageSize };
  if (spaceType === "room") {
    query.filter = "spaceType = SPACE";
  } else if (spaceType === "dm") {
    query.filter = "spaceType = DIRECT_MESSAGE";
  }
  let data: unknown;
  try {
    data = await opened.api.get(`${CHAT}/spaces`, query);
  } catch (e) {
    return errorResult(`listing spaces: ${errorText(e)}`);
  }
  const only = onlyIds(args);
  let spaces = arrField(data, "spaces");
  if (only) {
    spaces = spaces.filter((space) => only.has(strField(space, "name")));
    return jsonResult(spaces.map((space) => ({
      id: strField(space, "name"),
      name: strField(space, "displayName"),
    })));
  }
  if (spaces.length === 0) {
    return textResult(`No Chat spaces found for type '${spaceType}'.`);
  }
  let text = `Found ${spaces.length} Chat spaces (type: ${spaceType}):`;
  for (const space of spaces) {
    const name = strField(space, "displayName") || "Unnamed Space";
    const kind = strField(space, "spaceType") || "UNKNOWN";
    text += `\n- ${name} (ID: ${strField(space, "name")}, Type: ${kind})`;
  }
  return textResult(text);
}

async function listMessages(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "chat_list_messages(space_id=\"spaces/…\")"));
  if (isResult(opened)) {
    return opened;
  }
  const raw = requireString(args, "space_id");
  if (raw === undefined || raw.trim() === "") {
    return needArg("space_id", "chat_list_spaces() then chat_list_messages(space_id=\"spaces/…\")");
  }
  const spaceID = normalizeChatSpaceID(raw);
  const next = "chat_list_spaces() then chat_list_messages(space_id=\"spaces/…\")";
  let spaceInfo: unknown;
  try {
    spaceInfo = await opened.api.get(`${CHAT}/${spaceID}`);
  } catch (e) {
    return toolHint(`getting space info for ${spaceID}: ${errorText(e)}`, next);
  }
  const spaceName = strField(spaceInfo, "displayName") || "Unknown Space";
  let data: unknown;
  try {
    data = await opened.api.get(`${CHAT}/${spaceID}/messages`, {
      pageSize: getInt(args, "page_size", 50),
      orderBy: getString(args, "order_by", "createTime desc"),
    });
  } catch (e) {
    return toolHint(`listing messages: ${errorText(e)}`, next);
  }
  const messages = arrField(data, "messages");
  if (messages.length === 0) {
    return textResult(`No messages found in space '${spaceName}' (ID: ${spaceID}).`);
  }
  let text = `Messages from '${spaceName}' (ID: ${spaceID}):\n`;
  for (const msg of messages) {
    text += formatMessageBlock(msg);
  }
  return textResult(text);
}

function formatMessageBlock(msg: unknown): string {
  const sender = senderName(msg);
  const createTime = strField(msg, "createTime") || "Unknown Time";
  const body = strField(msg, "text") || "No text content";
  return `\n[${createTime}] ${sender}:\n  ${body}\n  (Message ID: ${strField(msg, "name")})\n`;
}

async function createMessage(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "chat_create_message(space_id=\"spaces/…\", message_text=…)"));
  if (isResult(opened)) {
    return opened;
  }
  const raw = requireString(args, "space_id");
  if (raw === undefined || raw.trim() === "") {
    return needArg("space_id", "chat_list_spaces() then chat_create_message(space_id=\"spaces/…\", message_text=…)");
  }
  const messageText = requireString(args, "message_text");
  if (messageText === undefined || messageText.trim() === "") {
    return needArg("message_text", "chat_create_message(space_id=\"spaces/…\", message_text=…)");
  }
  const spaceID = normalizeChatSpaceID(raw);
  const threadKey = getString(args, "thread_key", "");
  const query = threadKey === "" ? undefined : { threadKey };
  let message: unknown;
  try {
    message = await opened.api.post(`${CHAT}/${spaceID}/messages`, { text: messageText }, query);
  } catch (e) {
    return toolHint(`sending message: ${errorText(e)}`, "chat_list_spaces() then chat_create_message(space_id=\"spaces/…\", message_text=…)");
  }
  return textResult(`Message sent to space '${spaceID}' by ${opened.email}. Message ID: ${strField(message, "name")}, Time: ${strField(message, "createTime")}`);
}

async function searchMessages(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const opened = await openUser(ctx, args, call, needArg("user_google_email", "chat_search_messages(query=\"…\")"));
  if (isResult(opened)) {
    return opened;
  }
  const rawQuery = requireString(args, "query");
  if (rawQuery === undefined || rawQuery.trim() === "") {
    return needArg("query", "chat_search_messages(query=\"…\")");
  }
  const query = rawQuery.trim();
  const rawSpace = getString(args, "space_id", "").trim();
  const spaceID = rawSpace === "" ? "" : normalizeChatSpaceID(rawSpace);
  const pageSize = getInt(args, "page_size", 25);
  const filter = `text:"${query}"`;
  let results: { msg: unknown; spaceName: string }[];
  let searchContext: string;
  if (spaceID !== "") {
    try {
      const data = await opened.api.get(`${CHAT}/${spaceID}/messages`, { pageSize, filter });
      results = arrField(data, "messages").map((msg) => ({ msg, spaceName: "" }));
    } catch (e) {
      return toolHint(`searching messages: ${errorText(e)}`, "chat_list_spaces() then chat_search_messages(query=\"…\", space_id=\"spaces/…\")");
    }
    searchContext = `space '${spaceID}'`;
  } else {
    try {
      results = await searchAllSpaces(opened.api, filter);
    } catch (e) {
      return errorResult(errorText(e));
    }
    searchContext = "all accessible spaces";
  }
  if (results.length === 0) {
    return textResult(`No messages found matching '${query}' in ${searchContext}.`);
  }
  let text = `Found ${results.length} messages matching '${query}' in ${searchContext}:`;
  for (const row of results) {
    const sender = senderName(row.msg);
    const createTime = strField(row.msg, "createTime") || "Unknown Time";
    let body = strField(row.msg, "text") || "No text content";
    if (body.length > 100) {
      body = `${body.slice(0, 100)}...`;
    }
    const spaceName = row.spaceName || "Unknown Space";
    text += `\n- [${createTime}] ${sender} in '${spaceName}': ${body}`;
  }
  return textResult(text);
}

async function searchAllSpaces(api: { get(url: string, query?: Record<string, string | number>): Promise<unknown> }, filter: string): Promise<{ msg: unknown; spaceName: string }[]> {
  let spacesResp: unknown;
  try {
    spacesResp = await api.get(`${CHAT}/spaces`, { pageSize: 100 });
  } catch (e) {
    throw new Error(`listing spaces for search: ${errorText(e)}`, { cause: e });
  }
  const spaces = arrField(spacesResp, "spaces").slice(0, 10);
  const results: { msg: unknown; spaceName: string }[] = [];
  for (const space of spaces) {
    const name = strField(space, "name");
    try {
      const data = await api.get(`${CHAT}/${name}/messages`, { pageSize: 5, filter });
      const spaceName = strField(space, "displayName") || "Unknown";
      for (const msg of arrField(data, "messages")) {
        results.push({ msg, spaceName });
      }
    } catch {
      // Go skips spaces whose message list fails.
    }
  }
  return results;
}

function senderName(msg: unknown): string {
  if (!isRecord(msg)) {
    return "Unknown Sender";
  }
  const sender = msg.sender;
  const name = strField(sender, "displayName");
  return name || "Unknown Sender";
}
