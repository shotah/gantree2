import type { CallContext, PluginContext, Tool, ToolResult } from "@/harness/core/tools";
import { errorResult, jsonResult, textResult } from "@/harness/core/tools";
import {
  arrField,
  errorText,
  getInt,
  getString,
  getStringSlice,
  isRecord,
  numField,
  requireString,
  requireStringSlice,
  strField,
  needArg,
} from "@/harness/plugins/google/args";
import { toolDef } from "@/harness/plugins/google/catalog";
import { decodeBase64Std, decodeGmailBody, encodeBase64Std, encodeBase64Url } from "@/harness/plugins/google/codec";
import { connect, type GoogleClient } from "@/harness/plugins/google/http";
import { EmailRequired, resolveEmail } from "@/harness/plugins/google/oauth";
import { onlyIds } from "@/harness/plugins/google/plural";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const META_HEADERS = ["Subject", "From", "To", "Cc", "Date", "Message-ID"];

type Handler = (args: Record<string, unknown>, call: CallContext) => Promise<ToolResult>;

export function gmailTools(ctx: PluginContext): Tool[] {
  const bind = (name: string, fn: Handler): Tool => ({ ...toolDef(name), call: fn });
  return [
    bind("gmail_search_messages", (args, call) => searchMessages(ctx, args, call)),
    bind("gmail_get_message", (args, call) => getMessage(ctx, args, call)),
    bind("gmail_get_messages_batch", (args, call) => getMessagesBatch(ctx, args, call)),
    bind("gmail_get_attachment", (args, call) => getAttachment(ctx, args, call)),
    bind("gmail_get_thread", (args, call) => getThread(ctx, args, call)),
    bind("gmail_get_threads_batch", (args, call) => getThreadsBatch(ctx, args, call)),
    bind("gmail_list_labels", (args, call) => listLabels(ctx, args, call)),
    bind("gmail_create_message", (args, call) => createMessage(ctx, args, call)),
    bind("gmail_create_draft", (args, call) => createDraft(ctx, args, call)),
    bind("gmail_update_label", (args, call) => updateLabel(ctx, args, call)),
    bind("gmail_list_filters", (args, call) => listFilters(ctx, args, call)),
    bind("gmail_create_filter", (args, call) => createFilter(ctx, args, call)),
    bind("gmail_delete_filter", (args, call) => deleteFilter(ctx, args, call)),
    bind("gmail_update_message_labels", (args, call) => updateMessageLabels(ctx, args, call)),
    bind("gmail_batch_update_message_labels", (args, call) => batchUpdateLabels(ctx, args, call)),
  ];
}

async function user(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<{ email: string; api: GoogleClient }> {
  const email = await resolveEmail(ctx, args);
  const api = await connect(ctx, email, call.signal);
  return { email, api };
}

function caught(e: unknown, missingEmail: ToolResult): ToolResult {
  if (e instanceof EmailRequired) {
    return missingEmail;
  }
  return errorResult(errorText(e));
}

async function searchMessages(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const query = requireString(args, "query");
  if (query === undefined) {
    return needArg("query", `gmail_search_messages(query="from:… newer_than:7d")`);
  }
  let api: GoogleClient;
  try {
    ({ api } = await user(ctx, args, call));
  } catch (e) {
    return caught(e, needArg("USER_GOOGLE_EMAIL", `gmail_search_messages(query="…")`));
  }
  const pageSize = getInt(args, "page_size", 10);
  const pageToken = getString(args, "page_token", "");
  try {
    const data = await api.get(`${GMAIL}/messages`, {
      q: query,
      maxResults: pageSize,
      pageToken: pageToken || undefined,
    });
    return textResult(formatSearchResults(arrField(data, "messages"), query, strField(data, "nextPageToken")));
  } catch (e) {
    return errorResult(`Gmail API error: ${errorText(e)}`);
  }
}

function formatSearchResults(messages: unknown[], query: string, nextPageToken: string): string {
  if (messages.length === 0) {
    return `No messages found for query: '${query}'`;
  }
  let text = `Found ${messages.length} messages for query: '${query}'\n\n`;
  messages.forEach((msg, i) => {
    const id = strField(msg, "id");
    text += `${i + 1}. Message ID: ${id}\n`;
    text += `   Thread ID: ${strField(msg, "threadId")}\n`;
    text += `   Web Link: https://mail.google.com/mail/u/0/#inbox/${id}\n`;
    if (i < messages.length - 1) {
      text += "\n";
    }
  });
  if (nextPageToken) {
    text += `\n\nMore results available. Use page_token: '${nextPageToken}' to get the next page.`;
  }
  return text;
}

async function getMessage(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const messageID = requireString(args, "message_id");
  if (messageID === undefined) {
    return needArg("message_id", `gmail_search_messages(query="…") then gmail_get_message(message_id)`);
  }
  let api: GoogleClient;
  try {
    ({ api } = await user(ctx, args, call));
  } catch (e) {
    return caught(e, needArg("user_google_email", "gmail_get_message(message_id=…)"));
  }
  try {
    const meta = await api.get(`${GMAIL}/messages/${encodeURIComponent(messageID)}`, {
      format: "metadata",
      metadataHeaders: META_HEADERS,
    });
    const headers = extractHeaders(isRecord(meta) ? meta.payload : undefined, META_HEADERS);
    const full = await api.get(`${GMAIL}/messages/${encodeURIComponent(messageID)}`, { format: "full" });
    const payload = isRecord(full) ? full.payload : undefined;
    const bodies = extractMessageBodies(payload);
    const bodyData = formatBodyContent(bodies.text, bodies.html);
    const attachments = extractAttachments(payload);
    return textResult(formatMessageContent(messageID, headers, bodyData, attachments));
  } catch (e) {
    return errorResult(`Gmail API error: ${errorText(e)}`);
  }
}

function formatMessageContent(
  messageID: string,
  headers: Map<string, string>,
  bodyData: string,
  attachments: AttachmentMeta[],
): string {
  let text = `Subject: ${headerOr(headers, "Subject", "(no subject)")}\n`;
  text += `From:    ${headerOr(headers, "From", "(unknown sender)")}\n`;
  text += `Date:    ${headerOr(headers, "Date", "(unknown date)")}\n`;
  const msgID = headers.get("Message-ID") ?? "";
  if (msgID) {
    text += `Message-ID: ${msgID}\n`;
  }
  const to = headers.get("To") ?? "";
  if (to) {
    text += `To:      ${to}\n`;
  }
  const cc = headers.get("Cc") ?? "";
  if (cc) {
    text += `Cc:      ${cc}\n`;
  }
  text += `\n--- BODY ---\n${bodyData || "[No text/plain body found]"}`;
  if (attachments.length > 0) {
    text += "\n\n--- ATTACHMENTS ---\n";
    attachments.forEach((att, i) => {
      const sizeKB = att.size / 1024;
      text += `${i + 1}. ${att.filename} (${att.mimeType}, ${sizeKB.toFixed(1)} KB)\n`;
      text += `   Attachment ID: ${att.attachmentID}\n`;
      text += `   Use gmail_get_attachment(message_id='${messageID}', attachment_id='${att.attachmentID}') to download\n`;
    });
  }
  return text;
}

async function getMessagesBatch(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const messageIDs = requireStringSlice(args, "message_ids");
  if (!messageIDs || messageIDs.length === 0) {
    return needArg("message_ids", `gmail_get_messages_batch(message_ids=["id1","id2"])`);
  }
  let api: GoogleClient;
  try {
    ({ api } = await user(ctx, args, call));
  } catch (e) {
    return caught(e, needArg("user_google_email", `gmail_get_messages_batch(message_ids=[…])`));
  }
  const format = getString(args, "format", "full");
  const parts: string[] = [];
  for (const mid of messageIDs) {
    try {
      const msg = format === "metadata"
        ? await api.get(`${GMAIL}/messages/${encodeURIComponent(mid)}`, { format: "metadata", metadataHeaders: META_HEADERS })
        : await api.get(`${GMAIL}/messages/${encodeURIComponent(mid)}`, { format: "full" });
      parts.push(formatBatchMessage(mid, msg, format));
    } catch (e) {
      parts.push(`Message ${mid}: ${errorText(e)}`);
    }
  }
  return textResult(`Retrieved ${messageIDs.length} messages:\n\n${parts.join("\n---\n\n")}`);
}

function formatBatchMessage(mid: string, msg: unknown, format: string): string {
  const headers = extractHeaders(isRecord(msg) ? msg.payload : undefined, META_HEADERS);
  let text = `Message ID: ${mid}\n`;
  text += `Subject: ${headerOr(headers, "Subject", "(no subject)")}\n`;
  text += `From: ${headerOr(headers, "From", "(unknown sender)")}\n`;
  text += `Date: ${headerOr(headers, "Date", "(unknown date)")}\n`;
  const msgID = headers.get("Message-ID") ?? "";
  if (msgID) {
    text += `Message-ID: ${msgID}\n`;
  }
  const to = headers.get("To") ?? "";
  if (to) {
    text += `To: ${to}\n`;
  }
  const cc = headers.get("Cc") ?? "";
  if (cc) {
    text += `Cc: ${cc}\n`;
  }
  text += `Web Link: https://mail.google.com/mail/u/0/#inbox/${mid}\n`;
  if (format === "full") {
    const bodies = extractMessageBodies(isRecord(msg) ? msg.payload : undefined);
    const bodyData = formatBodyContent(bodies.text, bodies.html);
    if (bodyData) {
      text += `\n${bodyData}\n`;
    }
  }
  return text;
}

async function getAttachment(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const messageID = requireString(args, "message_id");
  if (messageID === undefined) {
    return errorResult("message_id is required");
  }
  const attachmentID = requireString(args, "attachment_id");
  if (attachmentID === undefined) {
    return errorResult("attachment_id is required");
  }
  let api: GoogleClient;
  try {
    ({ api } = await user(ctx, args, call));
  } catch (e) {
    return caught(e, errorResult("user_google_email is required"));
  }
  try {
    const att = await api.get(`${GMAIL}/messages/${encodeURIComponent(messageID)}/attachments/${encodeURIComponent(attachmentID)}`);
    const sizeBytes = numField(att, "size");
    const data = strField(att, "data");
    const preview = data.length > 100 ? data.slice(0, 100) : data;
    return textResult(
      `Attachment downloaded successfully!\nMessage ID: ${messageID}\nSize: ${(sizeBytes / 1024).toFixed(1)} KB (${sizeBytes} bytes)\n\nBase64-encoded content (first 100 characters shown):\n${preview}...\n\nNote: Attachment IDs are ephemeral. Always use IDs from the most recent message fetch.`,
    );
  } catch (e) {
    return errorResult(
      `Error: Failed to download attachment. The attachment ID may have changed.\nPlease fetch the message content again to get an updated attachment ID.\n\nError details: ${errorText(e)}`,
    );
  }
}

async function getThread(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const threadID = requireString(args, "thread_id");
  if (threadID === undefined) {
    return errorResult("thread_id is required");
  }
  let api: GoogleClient;
  try {
    ({ api } = await user(ctx, args, call));
  } catch (e) {
    return caught(e, errorResult("user_google_email is required"));
  }
  try {
    const thread = await api.get(`${GMAIL}/threads/${encodeURIComponent(threadID)}`, { format: "full" });
    return textResult(formatThreadContent(thread, threadID));
  } catch (e) {
    return errorResult(`Gmail API error: ${errorText(e)}`);
  }
}

function formatThreadContent(thread: unknown, threadID: string): string {
  const messages = arrField(thread, "messages");
  let text = `Thread ID: ${threadID}\nMessages in thread: ${messages.length}\n\n`;
  messages.forEach((msg, i) => {
    const headers = extractHeaders(isRecord(msg) ? msg.payload : undefined, META_HEADERS);
    text += `--- Message ${i + 1} of ${messages.length} ---\n`;
    text += `Message ID: ${strField(msg, "id")}\n`;
    text += `Subject: ${headerOr(headers, "Subject", "(no subject)")}\n`;
    text += `From: ${headerOr(headers, "From", "(unknown sender)")}\n`;
    text += `Date: ${headerOr(headers, "Date", "(unknown date)")}\n`;
    const to = headers.get("To") ?? "";
    if (to) {
      text += `To: ${to}\n`;
    }
    const cc = headers.get("Cc") ?? "";
    if (cc) {
      text += `Cc: ${cc}\n`;
    }
    const bodies = extractMessageBodies(isRecord(msg) ? msg.payload : undefined);
    const bodyData = formatBodyContent(bodies.text, bodies.html);
    text += bodyData ? `\n${bodyData}\n` : "\n[No body content]\n";
    text += "\n";
  });
  return text;
}

async function getThreadsBatch(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  const threadIDs = requireStringSlice(args, "thread_ids");
  if (threadIDs === undefined) {
    return errorResult("thread_ids is required");
  }
  if (threadIDs.length === 0) {
    return errorResult("No thread IDs provided");
  }
  let api: GoogleClient;
  try {
    ({ api } = await user(ctx, args, call));
  } catch (e) {
    return caught(e, errorResult("user_google_email is required"));
  }
  const parts: string[] = [];
  for (const tid of threadIDs) {
    try {
      const thread = await api.get(`${GMAIL}/threads/${encodeURIComponent(tid)}`, { format: "full" });
      parts.push(formatThreadContent(thread, tid));
    } catch (e) {
      parts.push(`Thread ${tid}: ${errorText(e)}`);
    }
  }
  return textResult(`Retrieved ${threadIDs.length} threads:\n\n${parts.join("\n---\n\n")}`);
}

async function listLabels(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  let api: GoogleClient;
  try {
    ({ api } = await user(ctx, args, call));
  } catch (e) {
    return caught(e, errorResult("user_google_email is required"));
  }
  try {
    const data = await api.get(`${GMAIL}/labels`);
    const only = onlyIds(args);
    let labels = arrField(data, "labels");
    if (only) {
      labels = labels.filter((label) => only.has(strField(label, "id")));
      return jsonResult(labels.map((label) => ({
        id: strField(label, "id"),
        name: strField(label, "name"),
        type: strField(label, "type"),
      })));
    }
    if (labels.length === 0) {
      return textResult("No labels found.");
    }
    const system = labels.filter((l) => strField(l, "type") === "system");
    const userLabels = labels.filter((l) => strField(l, "type") !== "system");
    let text = `Found ${labels.length} labels:\n`;
    if (system.length > 0) {
      text += "\nSYSTEM LABELS:\n";
      for (const l of system) {
        text += `  - ${strField(l, "name")} (ID: ${strField(l, "id")})\n`;
      }
    }
    if (userLabels.length > 0) {
      text += "\nUSER LABELS:\n";
      for (const l of userLabels) {
        text += `  - ${strField(l, "name")} (ID: ${strField(l, "id")})\n`;
      }
    }
    return textResult(text);
  } catch (e) {
    return errorResult(`Gmail API error: ${errorText(e)}`);
  }
}

async function createMessage(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  let email: string;
  let api: GoogleClient;
  try {
    ({ email, api } = await user(ctx, args, call));
  } catch (e) {
    return caught(e, needArg("user_google_email", "gmail_create_message(to, subject, body)"));
  }
  const to = requireString(args, "to");
  if (to === undefined) {
    return needArg("to", "gmail_create_message(to, subject, body)");
  }
  let subject = requireString(args, "subject");
  if (subject === undefined) {
    return needArg("subject", "gmail_create_message(to, subject, body)");
  }
  const body = requireString(args, "body");
  if (body === undefined) {
    return needArg("body", "gmail_create_message(to, subject, body)");
  }
  const inReplyTo = getString(args, "in_reply_to", "");
  if (inReplyTo && !subject.toLowerCase().startsWith("re:")) {
    subject = `Re: ${subject}`;
  }
  const sender = getString(args, "from_email", "") || email;
  const raw = buildRawMessage(ctx, args, sender, to, subject, body, inReplyTo);
  const threadID = getString(args, "thread_id", "");
  const message: Record<string, unknown> = { raw };
  if (threadID) {
    message.threadId = threadID;
  }
  try {
    const sent = await api.post(`${GMAIL}/messages/send`, message);
    return textResult(`Email sent successfully!\nMessage ID: ${strField(sent, "id")}`);
  } catch (e) {
    return errorResult(`Gmail API error: ${errorText(e)}`);
  }
}

async function createDraft(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  let email: string;
  let api: GoogleClient;
  try {
    ({ email, api } = await user(ctx, args, call));
  } catch (e) {
    return caught(e, errorResult("user_google_email is required"));
  }
  let subject = requireString(args, "subject");
  if (subject === undefined) {
    return errorResult("subject is required");
  }
  const body = requireString(args, "body");
  if (body === undefined) {
    return errorResult("body is required");
  }
  const inReplyTo = getString(args, "in_reply_to", "");
  if (inReplyTo && !subject.toLowerCase().startsWith("re:")) {
    subject = `Re: ${subject}`;
  }
  const sender = getString(args, "from_email", "") || email;
  const to = getString(args, "to", "");
  const raw = buildRawMessage(ctx, args, sender, to, subject, body, inReplyTo);
  const threadID = getString(args, "thread_id", "");
  const message: Record<string, unknown> = { raw };
  if (threadID) {
    message.threadId = threadID;
  }
  try {
    const created = await api.post(`${GMAIL}/drafts`, { message });
    return textResult(`Draft created successfully!\nDraft ID: ${strField(created, "id")}`);
  } catch (e) {
    return errorResult(`Gmail API error: ${errorText(e)}`);
  }
}

function buildRawMessage(
  ctx: PluginContext,
  args: Record<string, unknown>,
  from: string,
  to: string,
  subject: string,
  body: string,
  inReplyTo: string,
): string {
  const fromName = getString(args, "from_name", "");
  const cc = getString(args, "cc", "");
  const bcc = getString(args, "bcc", "");
  const references = getString(args, "references", "");
  const bodyFormat = getString(args, "body_format", "plain");
  const attachments = readAttachments(ctx, args);
  let msg = fromName ? `From: ${formatAddress(fromName, from)}\r\n` : `From: ${from}\r\n`;
  if (to) {
    msg += `To: ${to}\r\n`;
  }
  if (cc) {
    msg += `Cc: ${cc}\r\n`;
  }
  if (bcc) {
    msg += `Bcc: ${bcc}\r\n`;
  }
  msg += `Subject: ${encodeSubject(subject)}\r\n`;
  if (inReplyTo) {
    msg += `In-Reply-To: ${inReplyTo}\r\n`;
  }
  if (references) {
    msg += `References: ${references}\r\n`;
  }
  msg += "MIME-Version: 1.0\r\n";
  const contentType = bodyFormat === "html" ? "text/html" : "text/plain";
  if (attachments.length === 0) {
    msg += `Content-Type: ${contentType}; charset="UTF-8"\r\n\r\n${body}`;
  } else {
    const boundary = "boundary_mcp_go_attachment";
    msg += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
    msg += `--${boundary}\r\nContent-Type: ${contentType}; charset="UTF-8"\r\n\r\n${body}\r\n`;
    for (const att of attachments) {
      msg += `--${boundary}\r\n`;
      msg += `Content-Type: ${att.mimeType}; name="${att.filename}"\r\n`;
      msg += "Content-Transfer-Encoding: base64\r\n";
      msg += `Content-Disposition: attachment; filename="${att.filename}"\r\n\r\n`;
      msg += `${encodeBase64Std(att.data)}\r\n`;
    }
    msg += `--${boundary}--\r\n`;
  }
  return encodeBase64Url(new TextEncoder().encode(msg));
}

type EmailAttachment = { filename: string; mimeType: string; data: Uint8Array };

function readAttachments(ctx: PluginContext, args: Record<string, unknown>): EmailAttachment[] {
  const raw = args.attachments;
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: EmailAttachment[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    let mimeType = typeof item.mime_type === "string" ? item.mime_type : "";
    let filename = "";
    let data: Uint8Array | undefined;
    const path = typeof item.path === "string" ? item.path : "";
    if (path) {
      ctx.log.warn("gmail attachment path skipped; pass content base64", { path });
      continue;
    }
    const content = typeof item.content === "string" ? item.content : "";
    if (content) {
      data = decodeBase64Std(content);
      filename = typeof item.filename === "string" ? item.filename : "";
    }
    if (!data || data.length === 0) {
      continue;
    }
    if (!filename) {
      filename = "attachment";
    }
    if (!mimeType) {
      mimeType = "application/octet-stream";
    }
    result.push({ filename, mimeType, data });
  }
  return result;
}

function formatAddress(name: string, email: string): string {
  if ([...name].some((ch) => ch.charCodeAt(0) > 127)) {
    return `${qEncode(name)} <${email}>`;
  }
  const quoted = name.replace(/\\/gu, "\\\\").replace(/"/gu, "\\\"");
  return `"${quoted}" <${email}>`;
}

function encodeSubject(subject: string): string {
  if ([...subject].every((ch) => ch.charCodeAt(0) <= 127)) {
    return subject;
  }
  return qEncode(subject);
}

function qEncode(s: string): string {
  let out = "";
  for (const b of new TextEncoder().encode(s)) {
    if (b === 0x20) {
      out += "_";
    } else if (b >= 33 && b <= 126 && b !== 61 && b !== 63 && b !== 95) {
      out += String.fromCharCode(b);
    } else {
      out += `=${b.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return `=?utf-8?q?${out}?=`;
}

async function updateLabel(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  let api: GoogleClient;
  try {
    ({ api } = await user(ctx, args, call));
  } catch (e) {
    return caught(e, errorResult("user_google_email is required"));
  }
  const action = requireString(args, "action");
  if (action === undefined) {
    return errorResult("action is required");
  }
  const name = getString(args, "name", "");
  const labelID = getString(args, "label_id", "");
  const labelListVis = getString(args, "label_list_visibility", "labelShow");
  const msgListVis = getString(args, "message_list_visibility", "show");
  if (action === "create") {
    if (!name) {
      return errorResult("name is required for create action");
    }
    try {
      const created = await api.post(`${GMAIL}/labels`, {
        name,
        labelListVisibility: labelListVis,
        messageListVisibility: msgListVis,
      });
      return textResult(`Label created successfully!\nName: ${strField(created, "name")}\nID: ${strField(created, "id")}`);
    } catch (e) {
      return errorResult(`Gmail API error: ${errorText(e)}`);
    }
  }
  if (action === "update") {
    if (!labelID) {
      return errorResult("label_id is required for update action");
    }
    let current: unknown;
    try {
      current = await api.get(`${GMAIL}/labels/${encodeURIComponent(labelID)}`);
    } catch (e) {
      return errorResult(`Gmail API error fetching label: ${errorText(e)}`);
    }
    try {
      const updated = await api.put(`${GMAIL}/labels/${encodeURIComponent(labelID)}`, {
        name: name || strField(current, "name"),
        labelListVisibility: labelListVis,
        messageListVisibility: msgListVis,
      });
      return textResult(`Label updated successfully!\nName: ${strField(updated, "name")}\nID: ${strField(updated, "id")}`);
    } catch (e) {
      return errorResult(`Gmail API error: ${errorText(e)}`);
    }
  }
  if (action === "delete") {
    if (!labelID) {
      return errorResult("label_id is required for delete action");
    }
    let current: unknown;
    try {
      current = await api.get(`${GMAIL}/labels/${encodeURIComponent(labelID)}`);
    } catch (e) {
      return errorResult(`Gmail API error fetching label: ${errorText(e)}`);
    }
    try {
      await api.delete(`${GMAIL}/labels/${encodeURIComponent(labelID)}`);
    } catch (e) {
      return errorResult(`Gmail API error: ${errorText(e)}`);
    }
    return textResult(`Label deleted successfully!\nName: ${strField(current, "name")}\nID: ${strField(current, "id")}`);
  }
  return errorResult(`unknown action: ${action}`);
}

async function listFilters(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  let api: GoogleClient;
  try {
    ({ api } = await user(ctx, args, call));
  } catch (e) {
    return caught(e, errorResult("user_google_email is required"));
  }
  try {
    const data = await api.get(`${GMAIL}/settings/filters`);
    const only = onlyIds(args);
    let filters = arrField(data, "filter");
    if (only) {
      filters = filters.filter((filter) => only.has(strField(filter, "id")));
      return jsonResult(filters.map((filter) => ({ id: strField(filter, "id") })));
    }
    if (filters.length === 0) {
      return textResult("No filters found.");
    }
    let text = `Found ${filters.length} filters:\n\n`;
    filters.forEach((f, i) => {
      text += `${i + 1}. Filter ID: ${strField(f, "id")}\n`;
      if (isRecord(f) && isRecord(f.criteria)) {
        text += formatFilterCriteria(f.criteria);
      }
      if (isRecord(f) && isRecord(f.action)) {
        text += "   Actions:\n";
        if (typeof f.action.forward === "string" && f.action.forward) {
          text += `     Forward to: ${f.action.forward}\n`;
        }
        const add = stringList(f.action.addLabelIds);
        if (add.length > 0) {
          text += `     Add labels: ${add.join(", ")}\n`;
        }
        const remove = stringList(f.action.removeLabelIds);
        if (remove.length > 0) {
          text += `     Remove labels: ${remove.join(", ")}\n`;
        }
      }
      if (i < filters.length - 1) {
        text += "\n";
      }
    });
    return textResult(text);
  } catch (e) {
    return errorResult(`Gmail API error: ${errorText(e)}`);
  }
}

function formatFilterCriteria(criteria: Record<string, unknown>): string {
  let text = "   Criteria:\n";
  for (const [label, key] of [["From", "from"], ["To", "to"], ["Subject", "subject"], ["Query", "query"], ["Negated Query", "negatedQuery"]] as const) {
    const value = criteria[key];
    if (typeof value === "string" && value) {
      text += `     ${label}: ${value}\n`;
    }
  }
  if (criteria.hasAttachment === true) {
    text += "     Has Attachment: true\n";
  }
  if (criteria.excludeChats === true) {
    text += "     Exclude Chats: true\n";
  }
  if (typeof criteria.size === "number" && criteria.size > 0) {
    text += `     Size: ${criteria.size} (${typeof criteria.sizeComparison === "string" ? criteria.sizeComparison : ""})\n`;
  }
  return text;
}

async function createFilter(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  let api: GoogleClient;
  try {
    ({ api } = await user(ctx, args, call));
  } catch (e) {
    return caught(e, errorResult("user_google_email is required"));
  }
  if (!isRecord(args.criteria)) {
    return errorResult("criteria is required and must be an object");
  }
  if (!isRecord(args.action)) {
    return errorResult("action is required and must be an object");
  }
  const criteria = pickCriteria(args.criteria);
  const action = pickAction(args.action);
  try {
    const created = await api.post(`${GMAIL}/settings/filters`, { criteria, action });
    return textResult(`Filter created successfully!\nFilter ID: ${strField(created, "id")}`);
  } catch (e) {
    return errorResult(`Gmail API error: ${errorText(e)}`);
  }
}

function pickCriteria(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ["from", "to", "subject", "query", "negatedQuery", "sizeComparison"] as const) {
    const value = raw[key];
    if (typeof value === "string" && value) {
      out[key] = value;
    }
  }
  if (raw.hasAttachment === true) {
    out.hasAttachment = true;
  }
  if (raw.excludeChats === true) {
    out.excludeChats = true;
  }
  if (typeof raw.size === "number" && raw.size !== 0) {
    out.size = Math.trunc(raw.size);
  }
  return out;
}

function pickAction(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof raw.forward === "string" && raw.forward) {
    out.forward = raw.forward;
  }
  const add = stringList(raw.addLabelIds);
  if (add.length > 0) {
    out.addLabelIds = add;
  }
  const remove = stringList(raw.removeLabelIds);
  if (remove.length > 0) {
    out.removeLabelIds = remove;
  }
  return out;
}

async function deleteFilter(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  let api: GoogleClient;
  try {
    ({ api } = await user(ctx, args, call));
  } catch (e) {
    return caught(e, errorResult("user_google_email is required"));
  }
  const filterID = requireString(args, "filter_id");
  if (filterID === undefined) {
    return errorResult("filter_id is required");
  }
  let filter: unknown;
  try {
    filter = await api.get(`${GMAIL}/settings/filters/${encodeURIComponent(filterID)}`);
  } catch (e) {
    return errorResult(`Gmail API error fetching filter: ${errorText(e)}`);
  }
  try {
    await api.delete(`${GMAIL}/settings/filters/${encodeURIComponent(filterID)}`);
  } catch (e) {
    return errorResult(`Gmail API error: ${errorText(e)}`);
  }
  const criteria = isRecord(filter) && isRecord(filter.criteria) ? describeCriteria(filter.criteria) : "(none)";
  const action = isRecord(filter) && isRecord(filter.action) ? describeAction(filter.action) : "(none)";
  return textResult(`Filter deleted successfully!\nFilter ID: ${filterID}\nCriteria: ${criteria}\nAction: ${action}`);
}

function describeCriteria(criteria: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["from", "to", "subject", "query"] as const) {
    const value = criteria[key];
    if (typeof value === "string" && value) {
      parts.push(`${key}:${value}`);
    }
  }
  return parts.length === 0 ? "(none)" : parts.join(", ");
}

function describeAction(action: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof action.forward === "string" && action.forward) {
    parts.push(`forward:${action.forward}`);
  }
  const add = stringList(action.addLabelIds);
  if (add.length > 0) {
    parts.push(`addLabels:${add.join(",")}`);
  }
  const remove = stringList(action.removeLabelIds);
  if (remove.length > 0) {
    parts.push(`removeLabels:${remove.join(",")}`);
  }
  return parts.length === 0 ? "(none)" : parts.join(", ");
}

async function updateMessageLabels(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  let api: GoogleClient;
  try {
    ({ api } = await user(ctx, args, call));
  } catch (e) {
    return caught(e, errorResult("user_google_email is required"));
  }
  const messageID = requireString(args, "message_id");
  if (messageID === undefined) {
    return errorResult("message_id is required");
  }
  const addLabels = getStringSlice(args, "add_label_ids") ?? [];
  const removeLabels = getStringSlice(args, "remove_label_ids") ?? [];
  if (addLabels.length === 0 && removeLabels.length === 0) {
    return errorResult("at least one of add_label_ids or remove_label_ids must be provided");
  }
  const body: Record<string, unknown> = {};
  if (addLabels.length > 0) {
    body.addLabelIds = addLabels;
  }
  if (removeLabels.length > 0) {
    body.removeLabelIds = removeLabels;
  }
  try {
    await api.post(`${GMAIL}/messages/${encodeURIComponent(messageID)}/modify`, body);
  } catch (e) {
    return errorResult(`Gmail API error: ${errorText(e)}`);
  }
  let text = `Labels modified for message ${messageID}\n`;
  if (addLabels.length > 0) {
    text += `Added: ${addLabels.join(", ")}\n`;
  }
  if (removeLabels.length > 0) {
    text += `Removed: ${removeLabels.join(", ")}\n`;
  }
  return textResult(text);
}

async function batchUpdateLabels(ctx: PluginContext, args: Record<string, unknown>, call: CallContext): Promise<ToolResult> {
  let api: GoogleClient;
  try {
    ({ api } = await user(ctx, args, call));
  } catch (e) {
    return caught(e, errorResult("user_google_email is required"));
  }
  const messageIDs = requireStringSlice(args, "message_ids");
  if (messageIDs === undefined) {
    return errorResult("message_ids is required");
  }
  if (messageIDs.length === 0) {
    return errorResult("message_ids must not be empty");
  }
  const addLabels = getStringSlice(args, "add_label_ids") ?? [];
  const removeLabels = getStringSlice(args, "remove_label_ids") ?? [];
  if (addLabels.length === 0 && removeLabels.length === 0) {
    return errorResult("at least one of add_label_ids or remove_label_ids must be provided");
  }
  const body: Record<string, unknown> = { ids: messageIDs };
  if (addLabels.length > 0) {
    body.addLabelIds = addLabels;
  }
  if (removeLabels.length > 0) {
    body.removeLabelIds = removeLabels;
  }
  try {
    await api.post(`${GMAIL}/messages/batchModify`, body);
  } catch (e) {
    return errorResult(`Gmail API error: ${errorText(e)}`);
  }
  let text = `Labels modified for ${messageIDs.length} messages\n`;
  if (addLabels.length > 0) {
    text += `Added: ${addLabels.join(", ")}\n`;
  }
  if (removeLabels.length > 0) {
    text += `Removed: ${removeLabels.join(", ")}\n`;
  }
  return textResult(text);
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v.filter((item): item is string => typeof item === "string");
}

type AttachmentMeta = { filename: string; mimeType: string; size: number; attachmentID: string };

function extractHeaders(payload: unknown, names: string[]): Map<string, string> {
  const want = new Set(names);
  const result = new Map<string, string>();
  if (!isRecord(payload) || !Array.isArray(payload.headers)) {
    return result;
  }
  for (const h of payload.headers) {
    if (!isRecord(h) || typeof h.name !== "string" || typeof h.value !== "string") {
      continue;
    }
    if (want.has(h.name)) {
      result.set(h.name, h.value);
    }
  }
  return result;
}

function headerOr(headers: Map<string, string>, key: string, fallback: string): string {
  const v = headers.get(key);
  return v ? v : fallback;
}

function extractAttachments(payload: unknown): AttachmentMeta[] {
  const result: AttachmentMeta[] = [];
  const walk = (part: unknown): void => {
    if (!isRecord(part)) {
      return;
    }
    const filename = typeof part.filename === "string" ? part.filename : "";
    const body = isRecord(part.body) ? part.body : undefined;
    const attachmentID = body && typeof body.attachmentId === "string" ? body.attachmentId : "";
    if (filename && attachmentID) {
      result.push({
        filename,
        mimeType: typeof part.mimeType === "string" ? part.mimeType : "",
        size: body && typeof body.size === "number" ? body.size : 0,
        attachmentID,
      });
    }
    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        walk(child);
      }
    }
  };
  walk(payload);
  return result;
}

function extractMessageBodies(payload: unknown): { text: string; html: string } {
  let text = "";
  let html = "";
  const walk = (part: unknown): void => {
    if (!isRecord(part)) {
      return;
    }
    const mime = typeof part.mimeType === "string" ? part.mimeType : "";
    const data = isRecord(part.body) && typeof part.body.data === "string" ? part.body.data : "";
    if (mime === "text/plain" && !text && data) {
      text = decodeGmailBody(data);
    } else if (mime === "text/html" && !html && data) {
      html = decodeGmailBody(data);
    }
    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        walk(child);
      }
    }
  };
  walk(payload);
  return { text, html };
}

function formatBodyContent(textBody: string, htmlBody: string): string {
  if (textBody) {
    return textBody;
  }
  if (htmlBody) {
    return `[HTML body - plain text not available]\n${htmlBody}`;
  }
  return "";
}
